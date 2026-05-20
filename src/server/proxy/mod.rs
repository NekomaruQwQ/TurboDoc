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
//! injection), and `location` (for 3xx) are forwarded to the caller. All
//! other upstream headers (Set-Cookie, Server, X-*, etc.) are stripped so
//! the WebView2 client only sees what it needs.

mod cache;
mod inject;
mod revalidate;

use std::time::SystemTime;

use http_cache_semantics::BeforeRequest;
use http_cache_semantics::CachePolicy;

use crate::server::proxy::cache::CacheEntry;
use crate::server::state::AppState;

/// Per-call knobs for [`fetch`]. Most callers pass `Default::default()`;
/// the crates batch endpoint sets `force_refresh` for the explicit
/// `?refresh=true` flag.
#[derive(Default, Clone, Copy)]
pub(crate) struct FetchOpts {
    /// Skip the cache lookup entirely. The fresh upstream response is
    /// still stored, so subsequent calls hit cache.
    pub force_refresh: bool,
}

/// URL-prefix policy for synthesizing `cache-control` on upstream
/// responses that don't emit useful cache headers. Applied transparently
/// inside [`http_response_from_reqwest`] for both the initial fetch and
/// background revalidation, so callers don't have to thread a `synth_max_age`
/// parameter through.
///
/// Currently: crates.io's API responses get a 24h TTL.
fn synth_max_age_for(url: &str) -> Option<u64> {
    if url.starts_with("https://crates.io/api/v1/crates/") {
        // 24h — crate metadata changes infrequently, version publishes
        // aren't time-critical for a docs viewer.
        return Some(86_400);
    }
    None
}

/// Fetch `url` through the proxy pipeline: cache lookup → fresh hit / stale
/// hit + background revalidation / miss + upstream fetch → dark-mode
/// injection. Called by [`crate::server::Server::fetch`] (sync host path)
/// and the cache-warming spawn in [`crate::server::api::crates`].
pub(crate) async fn fetch(
    state: &AppState,
    url: &str,
    opts: FetchOpts,
) -> anyhow::Result<http::Response<Vec<u8>>> {
    let synth_req =
        http::Request::builder()
            .method("GET")
            .uri(url)
            .body(())?;

    // 1. Cache lookup (unless force_refresh skips it).
    if !opts.force_refresh
        && let Some(entry) = cache::get(&state.db, url).await
    {
        match entry.policy.before_request(&synth_req, SystemTime::now()) {
            BeforeRequest::Fresh(_) => {
                log::info!("[proxy] HIT (fresh) {url}");
                return Ok(serve_entry(url, entry));
            },
            BeforeRequest::Stale { .. } => {
                log::info!("[proxy] HIT (stale, revalidating in background) {url}");
                let serve_status = entry.status_code;
                let serve_ct = entry.content_type.clone();
                let serve_loc = entry.location.clone();
                let serve_body = entry.body.clone();
                revalidate::enqueue(state.clone(), url.to_owned(), entry);
                return Ok(serve(url, serve_status, &serve_ct, &serve_loc, serve_body));
            },
        }
    }

    // 2. Cache miss (or forced refresh) — fetch upstream.
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

    // Build the `http::Response<()>` shell for CachePolicy. URL-prefix
    // policy (see `synth_max_age_for`) may override the upstream
    // cache-control so the policy decides the entry is cacheable with a
    // synthesized TTL.
    let http_resp = http_response_from_reqwest(&response, url);
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

/// Cache-only lookup. Returns the cached response if present (Fresh or
/// Stale); returns `None` on miss. For stale hits, enqueues a background
/// revalidation just like [`fetch`] does — so a repeated `peek`-only
/// access pattern still refreshes the cache.
///
/// Used by the crates batch endpoint to avoid blocking the UI thread on
/// upstream fetches; cold misses are handled by the caller spawning a
/// warming task (which calls [`fetch`] on a tokio worker).
pub(crate) async fn peek(state: &AppState, url: &str) -> Option<http::Response<Vec<u8>>> {
    let entry = cache::get(&state.db, url).await?;
    let synth_req =
        http::Request::builder()
            .method("GET")
            .uri(url)
            .body(())
            .ok()?;
    match entry.policy.before_request(&synth_req, SystemTime::now()) {
        BeforeRequest::Fresh(_) => {
            log::info!("[proxy] HIT (fresh, peek) {url}");
            Some(serve_entry(url, entry))
        },
        BeforeRequest::Stale { .. } => {
            log::info!("[proxy] HIT (stale, peek; revalidating in background) {url}");
            let serve_status = entry.status_code;
            let serve_ct = entry.content_type.clone();
            let serve_loc = entry.location.clone();
            let serve_body = entry.body.clone();
            revalidate::enqueue(state.clone(), url.to_owned(), entry);
            Some(serve(url, serve_status, &serve_ct, &serve_loc, serve_body))
        },
    }
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
            .body(Vec::new())
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
/// Applies [`synth_max_age_for`] for URLs whose upstream omits useful cache
/// headers — the synthesized `cache-control` replaces the upstream value.
///
/// We do this manually instead of enabling `http-cache-semantics`'s
/// `reqwest` feature because that feature pins reqwest 0.13 and our host
/// uses 0.12 (an upstream `aws-lc-sys` build issue blocks 0.13).
pub(crate) fn http_response_from_reqwest(resp: &reqwest::Response, url: &str) -> http::Response<()> {
    let synth = synth_max_age_for(url);
    let mut builder = http::Response::builder().status(resp.status());
    for (name, value) in resp.headers() {
        if synth.is_some() && name == http::header::CACHE_CONTROL { continue; }
        builder = builder.header(name, value);
    }
    if let Some(secs) = synth {
        builder = builder.header(http::header::CACHE_CONTROL, format!("public, max-age={secs}"));
    }
    builder.body(()).expect("valid http response shell")
}
