//! In-process HTTP proxy with RFC 7234 caching and rustdoc dark-mode
//! injection. Called from the host's WebView2 `WebResourceRequested`
//! handler via [`crate::server::Server::fetch`].
//!
//! Three serving paths:
//! - **Fresh HIT**: cached entry is still fresh → serve immediately.
//! - **Stale HIT**: cached entry is stale → serve immediately + enqueue a
//!   background revalidation (stale-while-revalidate).
//! - **MISS**: no cached entry → fetch upstream, cache if storable, serve.
//!
//! Only `content-type`, `content-length` (recomputed after dark-mode
//! injection), and `location` (for 3xx) are forwarded to the caller. A
//! permissive CORS header is added because frontend-owned cross-origin GETs
//! are served from this trusted in-process proxy. All other upstream headers
//! (Set-Cookie, Server, X-*, etc.) are stripped.

mod cache;
mod inject;
mod revalidate;

use std::time::SystemTime;

use http_cache_semantics::BeforeRequest;
use http_cache_semantics::CachePolicy;

use crate::prelude::WebRequest;
use crate::server::proxy::cache::CacheEntry;
use crate::server::state::AppState;

/// Fetch `request` through the proxy pipeline: cache lookup → fresh hit / stale
/// hit + background revalidation / miss + upstream fetch → dark-mode
/// injection. Explicit `no-cache`/`no-store` request directives skip lookup,
/// which lets callers request a current representation without any
/// site-specific cache policy.
pub(crate) async fn fetch(
    state: &AppState,
    request: &WebRequest) -> anyhow::Result<http::Response<Vec<u8>>> {
    let url = request.uri().to_string();
    let cache_request = cache_request_from(request)?;

    // Request cache directives are honored generically. An unconditional
    // upstream request is intentional for reloads: it avoids serving stale
    // data while leaving response storage to the RFC policy below.
    if !request_bypasses_cache(request)
        && let Some(entry) = cache::get(&state.db, &url).await
    {
        match entry.policy.before_request(&cache_request, SystemTime::now()) {
            BeforeRequest::Fresh(_) => {
                log::info!("[proxy] HIT (fresh) {url}");
                return Ok(serve_entry(&url, entry));
            },
            BeforeRequest::Stale { .. } => {
                log::info!("[proxy] HIT (stale, revalidating in background) {url}");
                let serve_status = entry.status_code;
                let serve_ct = entry.content_type.clone();
                let serve_loc = entry.location.clone();
                let serve_body = entry.body.clone();
                revalidate::enqueue(state.clone(), url.clone(), entry);
                return Ok(serve(&url, serve_status, &serve_ct, &serve_loc, serve_body));
            },
        }
    }

    // Cache miss or explicit reload — fetch upstream.
    log::info!("[proxy] MISS {url}");
    let response = state.http_client.get(&url).send().await?;
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

    let http_resp = http_response_from_reqwest(&response);
    let policy = CachePolicy::new(&cache_request, &http_resp);
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
        if let Err(err) = cache::set(&state.db, &url, entry).await {
            log::warn!("[proxy] failed to store cache entry for {url}: {err}");
        }
    }

    Ok(serve(&url, status, &content_type, &location, body))
}

/// Clone the intercepted request without its body for cache-policy decisions.
/// Headers matter here because standard request directives such as
/// `Cache-Control: no-cache` affect reuse and storage.
fn cache_request_from(request: &WebRequest) -> anyhow::Result<http::Request<()>> {
    let mut builder =
        http::Request::builder()
            .method(request.method().clone())
            .uri(request.uri().clone());
    for (name, value) in request.headers() {
        builder = builder.header(name, value);
    }
    Ok(builder.body(())?)
}

/// Whether an intercepted request explicitly forbids reuse of a cached
/// response. Matching comma-separated directives case-insensitively keeps
/// this compatible with browser-generated `fetch(..., { cache })` headers.
fn request_bypasses_cache(request: &WebRequest) -> bool {
    has_header_directive(request, http::header::CACHE_CONTROL, "no-cache")
        || has_header_directive(request, http::header::CACHE_CONTROL, "no-store")
        || has_header_directive(request, http::header::PRAGMA, "no-cache")
}

fn has_header_directive(
    request: &WebRequest,
    header: http::header::HeaderName,
    directive: &str) -> bool {
    request
        .headers()
        .get_all(header)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(|value| {
            let value = value.trim();
            value.split_once('=').map_or(value, |(name, _)| name.trim())
        })
        .any(|value| value.eq_ignore_ascii_case(directive))
}

/// Serve a cached entry. Convenience wrapper around `serve` that owns the
/// entry's body.
fn serve_entry(url: &str, entry: CacheEntry) -> http::Response<Vec<u8>> {
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
) -> http::Response<Vec<u8>> {
    if (300..400).contains(&status) {
        // 3xx — forward Location header only, no body. WebView2 will follow
        // the redirect and re-trigger interception.
        return http::Response::builder()
            .status(status)
            .header("location", location)
            .header("access-control-allow-origin", "*")
            .body(Vec::new())
            .expect("valid redirect response");
    }

    let final_body = body.map(|b| inject::dark_mode(url, content_type, b));

    let mut builder =
        http::Response::builder()
            .status(status)
            .header("access-control-allow-origin", "*");
    if !content_type.is_empty() {
        builder = builder.header("content-type", content_type);
    }
    match final_body {
        Some(b) => {
            builder = builder.header("content-length", b.len().to_string());
            builder
                .body(b)
                .expect("valid response body")
        },
        None =>
            builder
                .body(Vec::new())
                .expect("valid empty body"),
    }
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

#[cfg(test)]
mod tests {
    use super::request_bypasses_cache;
    use super::serve;

    fn request_with(header: Option<(&str, &str)>) -> crate::prelude::WebRequest {
        let mut builder = http::Request::builder().method("GET").uri("https://example.com/");
        if let Some((name, value)) = header {
            builder = builder.header(name, value);
        }
        builder.body(Vec::new()).expect("valid test request")
    }

    #[test]
    fn bypasses_cache_for_standard_reload_directives() {
        assert!(request_bypasses_cache(&request_with(Some(("cache-control", "no-cache")))));
        assert!(request_bypasses_cache(&request_with(Some(("cache-control", "max-age=0, NO-STORE")))));
        assert!(request_bypasses_cache(&request_with(Some(("pragma", "no-cache")))));
        assert!(request_bypasses_cache(&request_with(Some(("cache-control", "no-cache=\"set-cookie\"")))));
    }

    #[test]
    fn reuses_cache_for_requests_without_bypass_directives() {
        assert!(!request_bypasses_cache(&request_with(None)));
        assert!(!request_bypasses_cache(&request_with(Some(("cache-control", "max-age=600")))));
    }

    #[test]
    fn proxied_responses_allow_frontend_cross_origin_reads() {
        let response = serve(
            "https://example.com/data",
            200,
            "text/plain",
            "",
            Some(b"body".to_vec()));
        assert_eq!(response.headers()["access-control-allow-origin"], "*");
    }
}
