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
//! An explicit response-header allowlist exposes representation and cache
//! semantics to WebView2 while blocking connection, browser-state, unsupported
//! range, and transformation-invalidated fields. Final length and scoped CORS
//! are synthesized at serve time.

mod cache;
mod headers;
mod inject;
mod revalidate;

use std::time::SystemTime;

use http_cache_semantics::BeforeRequest;
use http_cache_semantics::CachePolicy;

use crate::prelude::WebRequest;
use crate::server::proxy::cache::CacheEntry;
use crate::server::proxy::headers::cors_policy_for;
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
            BeforeRequest::Fresh(parts) => {
                log::info!("[proxy] HIT (fresh) {url}");
                return Ok(serve(
                    &url,
                    parts.status,
                    &parts.headers,
                    entry.body,
                    false));
            },
            BeforeRequest::Stale { .. } => {
                log::info!("[proxy] HIT (stale, revalidating in background) {url}");
                let serve_status = http::StatusCode::from_u16(entry.status_code)?;
                let mut serve_headers = entry.response_headers.clone();
                serve_headers.insert(
                    http::header::AGE,
                    http::HeaderValue::from_str(
                        &entry.policy.age(SystemTime::now()).as_secs().to_string())?);
                let serve_body = entry.body.clone();
                revalidate::enqueue(state.clone(), url.clone(), entry);
                return Ok(serve(
                    &url,
                    serve_status,
                    &serve_headers,
                    serve_body,
                    true));
            },
        }
    }

    // Cache miss or explicit reload — fetch upstream.
    log::info!("[proxy] MISS {url}");
    let response = state.http_client.get(&url).send().await?;
    let status = response.status();
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
    let is_redirect = status.is_redirection();

    let http_resp = http_response_from_reqwest(&response);
    let policy = CachePolicy::new(&cache_request, &http_resp);
    let response_headers = headers::allowed_upstream_headers(http_resp.headers());
    let body =
        if is_redirect { None } else { Some(response.bytes().await?.to_vec()) };

    if policy.is_storable() && (status == http::StatusCode::OK || is_redirect) {
        let entry = CacheEntry {
            policy,
            status_code: status.as_u16(),
            content_type: content_type.clone(),
            location: location.clone(),
            response_headers: response_headers.clone(),
            body: body.clone(),
        };
        if let Err(err) = cache::set(&state.db, &url, entry).await {
            log::warn!("[proxy] failed to store cache entry for {url}: {err}");
        }
    }

    Ok(serve(&url, status, &response_headers, body, false))
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

/// Build the response sent to the WebView2 caller. Applies dark-mode
/// injection for rustdoc HTML and applies the explicit downstream header
/// policy to the final representation.
fn serve(
    url: &str,
    status: http::StatusCode,
    response_headers: &http::HeaderMap,
    body: Option<Vec<u8>>,
    served_stale: bool,
) -> http::Response<Vec<u8>> {
    let status_has_no_body =
        status.is_informational()
            || status.is_redirection()
            || matches!(
                status,
                http::StatusCode::NO_CONTENT
                    | http::StatusCode::RESET_CONTENT
                    | http::StatusCode::NOT_MODIFIED);
    let content_type =
        response_headers
            .get(http::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
    let injected =
        if status_has_no_body {
            None
        } else {
            body.map(|body| inject::dark_mode(url, content_type, body))
        };
    let body_modified =
        injected
            .as_ref()
            .is_some_and(|body| body.modified);
    let body_len = injected.as_ref().map(|body| body.bytes.len());
    let webview_headers =
        headers::build_webview_headers(
            response_headers,
            status,
            body_len,
            body_modified,
            served_stale,
            cors_policy_for(url));

    let mut response =
        http::Response::new(
            injected
                .map_or_else(Vec::new, |body| body.bytes));
    *response.status_mut() = status;
    *response.headers_mut() = webview_headers;
    response
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
    fn public_metadata_responses_allow_frontend_cross_origin_reads() {
        let response = serve(
            "https://index.crates.io/se/rd/serde",
            http::StatusCode::OK,
            &http::HeaderMap::new(),
            Some(b"body".to_vec()),
            false);
        assert_eq!(response.headers()["access-control-allow-origin"], "*");
    }

    #[test]
    fn documentation_responses_do_not_gain_wildcard_cors() {
        let response = serve(
            "https://docs.rs/serde/latest/serde/",
            http::StatusCode::OK,
            &http::HeaderMap::new(),
            Some(b"body".to_vec()),
            false);
        assert!(!response.headers().contains_key("access-control-allow-origin"));
    }

    #[test]
    fn injected_html_keeps_freshness_and_gets_final_length() {
        let mut headers = http::HeaderMap::new();
        headers.insert(
            http::header::CONTENT_TYPE,
            http::HeaderValue::from_static("text/html"));
        headers.insert(
            http::header::CACHE_CONTROL,
            http::HeaderValue::from_static("public, max-age=600"));
        headers.insert(
            http::header::ETAG,
            http::HeaderValue::from_static("\"upstream\""));
        let response = serve(
            "https://docs.rs/serde/latest/serde/",
            http::StatusCode::OK,
            &headers,
            Some(b"<meta charset=\"UTF-8\"><main>serde</main>".to_vec()),
            false);

        assert_eq!(response.headers()["cache-control"], "public, max-age=600");
        assert_eq!(
            response.headers()["content-length"],
            response.body().len().to_string());
        assert!(!response.headers().contains_key("etag"));
        assert!(
            String::from_utf8_lossy(response.body())
                .contains("window.localStorage.setItem"));
    }
}
