//! `GET /proxy?url=…` — fetch a documentation page on behalf of the WebView2
//! host, with RFC 7234 caching and rustdoc dark-mode injection.
//!
//! Three serving paths:
//! - **Fresh HIT**: cached entry is still fresh → serve immediately.
//! - **Stale HIT**: cached entry is stale → serve immediately + enqueue a
//!   background revalidation (stale-while-revalidate).
//! - **MISS**: no cached entry → fetch upstream, cache if storable, serve.
//!
//! Only `content-type`, `content-length` (recomputed after dark-mode
//! injection), and `location` (for 3xx) are forwarded to the caller. All
//! other upstream headers (Set-Cookie, Server, X-*, etc.) are stripped so
//! the WebView2 client only sees what it needs.

mod cache;
mod inject;
mod revalidate;

use std::time::SystemTime;

use axum::Router;
use axum::body::Body;
use axum::extract::Query;
use axum::extract::State;
use axum::response::Response;
use axum::routing::get;
use http_cache_semantics::BeforeRequest;
use http_cache_semantics::CachePolicy;
use serde::Deserialize;

use crate::server::proxy::cache::CacheEntry;
use crate::server::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(handle_proxy))
}

#[derive(Deserialize)]
pub struct ProxyQuery {
    pub url: Option<String>,
}

async fn handle_proxy(
    State(state): State<AppState>,
    Query(query): Query<ProxyQuery>,
) -> Response {
    let url = match query.url.filter(|u| !u.is_empty()) {
        Some(u) => u,
        None => return error_response(400, "Missing 'url' query parameter"),
    };

    match dispatch(&state, &url).await {
        Ok(response) => response,
        Err(err) => {
            log::error!("[proxy] error fetching {url}: {err:#}");
            error_response(502, "Bad Gateway")
        },
    }
}

async fn dispatch(state: &AppState, url: &str) -> anyhow::Result<Response> {
    let synth_req =
        http::Request::builder()
            .method("GET")
            .uri(url)
            .body(())?;

    // 1. Cache lookup
    if let Some(entry) = cache::get(&state.db, url).await {
        match entry.policy.before_request(&synth_req, SystemTime::now()) {
            BeforeRequest::Fresh(_) => {
                log::info!("[proxy] HIT (fresh) {url}");
                return Ok(serve_entry(url, entry));
            },
            BeforeRequest::Stale { .. } => {
                log::info!("[proxy] HIT (stale, revalidating in background) {url}");
                // Clone the body for the in-flight serve; move the rest into
                // the revalidator so it can update the cache when upstream
                // responds.
                let serve_status = entry.status_code;
                let serve_ct = entry.content_type.clone();
                let serve_loc = entry.location.clone();
                let serve_body = entry.body.clone();
                revalidate::enqueue(state.clone(), url.to_owned(), entry);
                return Ok(serve(url, serve_status, &serve_ct, &serve_loc, serve_body));
            },
        }
    }

    // 2. Cache miss — fetch upstream
    log::info!("[proxy] MISS {url}");
    let response = state.http_client.get(url).send().await?;
    let status = response.status().as_u16();
    let content_type =
        response.headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_owned();
    let location =
        response.headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_owned();
    let is_redirect = (300..400).contains(&status);

    // CachePolicy is built off `http::Response<()>` — we copy the
    // status/headers from reqwest first (which doesn't consume the
    // response) and then consume the body separately.
    let http_resp = http_response_from_reqwest(&response);
    let policy = CachePolicy::new(&synth_req, &http_resp);
    let body =
        if is_redirect { None } else { Some(response.bytes().await?.to_vec()) };

    if policy.is_storable() && (status == 200 || is_redirect) {
        let entry = CacheEntry {
            policy,
            status_code: status,
            content_type: content_type.clone(),
            location: location.clone(),
            body: body.clone(),
        };
        if let Err(err) = cache::set(&state.db, url, entry).await {
            log::warn!("[proxy] failed to store cache entry for {url}: {err}");
        }
    }

    Ok(serve(url, status, &content_type, &location, body))
}

/// Serve a cached entry. Convenience wrapper around `serve` that owns the
/// entry's body.
fn serve_entry(url: &str, entry: CacheEntry) -> Response {
    serve(url, entry.status_code, &entry.content_type, &entry.location, entry.body)
}

/// Build the response sent to the WebView2 caller. Applies dark-mode
/// injection for rustdoc HTML and forwards only the headers the WebView
/// actually needs.
fn serve(
    url: &str,
    status: u16,
    content_type: &str,
    location: &str,
    body: Option<Vec<u8>>,
) -> Response {
    if (300..400).contains(&status) {
        // 3xx — forward Location header only, no body. WebView2 will follow
        // the redirect and re-trigger interception.
        return http::Response::builder()
            .status(status)
            .header("location", location)
            .body(Body::empty())
            .expect("valid redirect response");
    }

    let final_body = body.map(|b| inject::dark_mode(url, content_type, b));

    let mut builder = http::Response::builder().status(status);
    if !content_type.is_empty() {
        builder = builder.header("content-type", content_type);
    }
    match final_body {
        Some(b) => {
            builder = builder.header("content-length", b.len().to_string());
            builder
                .body(Body::from(b))
                .expect("valid response body")
        },
        None =>
            builder
                .body(Body::empty())
                .expect("valid empty body"),
    }
}

fn error_response(status: u16, message: &str) -> Response {
    http::Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(Body::from(message.to_owned()))
        .expect("valid error response")
}

/// Convert a `reqwest::Response` into an `http::Response<()>` for
/// `CachePolicy` (which only reads status + headers). The body stays in the
/// reqwest response so the caller can `.bytes().await` it afterwards.
///
/// We do this manually instead of enabling `http-cache-semantics`'s
/// `reqwest` feature because that feature pins reqwest 0.13 and our host
/// uses 0.12 (an upstream `aws-lc-sys` build issue blocks 0.13).
pub(crate) fn http_response_from_reqwest(resp: &reqwest::Response) -> http::Response<()> {
    let mut builder = http::Response::builder().status(resp.status());
    for (name, value) in resp.headers() {
        builder = builder.header(name, value);
    }
    builder.body(()).expect("valid http response shell")
}
