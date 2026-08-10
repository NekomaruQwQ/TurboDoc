//! `/api` request dispatcher. Called from the host's WebView2
//! `WebResourceRequested` callback (via [`crate::server::Server::dispatch_api`])
//! for every API path except Vite-owned `/api/ready`.
//!
//! Replaces the former axum router + Hono-format access-log middleware.
//! The log format is preserved for habit's sake.

mod data;

use crate::prelude::*;
use crate::server::state::AppState;

/// Dispatch an intercepted `/api` request to the matching handler.
/// Always returns a response — internal errors are turned into 4xx/5xx
/// responses inside the handlers, never propagated as panics.
///
/// Logs each request in `<METHOD> <PATH> -> <STATUS> (<CTYPE>)` format,
/// matching the former axum middleware.
pub async fn dispatch(state: &AppState, req: WebRequest) -> http::Response<Vec<u8>> {
    let method = req.method().clone();
    let path = req.uri().path().to_owned();
    let body = req.into_body();

    let response = route(state, &method, &path, &body).await;

    let status = response.status().as_u16();
    let content_type =
        response.headers()
            .get(http::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
    log::info!("{method} {path} -> {status} ({content_type})");

    response
}

/// Route a classified request to provider storage or a protocol error.
async fn route(
    state: &AppState,
    method: &http::Method,
    path: &str,
    body: &[u8],
) -> http::Response<Vec<u8>> {
    match classify_route(method, path) {
        ApiRoute::GetData(provider_id) => data::get(state, provider_id).await,
        ApiRoute::PutData(provider_id) => data::put(state, provider_id, body).await,
        ApiRoute::MethodNotAllowed => method_not_allowed(),
        ApiRoute::InvalidProviderId => text_error(400, "invalid provider id"),
        ApiRoute::NotFound => text_error(404, "not found"),
    }
}

/// Classified Rust API route with its validated dynamic data.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ApiRoute<'a> {
    /// Provider data read carrying a filesystem-safe provider ID.
    GetData(&'a str),
    /// Provider data write carrying a filesystem-safe provider ID.
    PutData(&'a str),
    /// Data route requested with a method other than GET or PUT.
    MethodNotAllowed,
    /// Data-shaped route whose provider ID violates the identifier contract.
    InvalidProviderId,
    /// Any API path not implemented by Rust.
    NotFound,
}

/// Classify a Rust-owned API request and validate its provider identifier.
fn classify_route<'a>(method: &http::Method, path: &'a str) -> ApiRoute<'a> {
    let Some(provider_id) = path.strip_prefix("/api/data/") else {
        return ApiRoute::NotFound;
    };
    if !is_valid_provider_id(provider_id) {
        return ApiRoute::InvalidProviderId;
    }
    match *method {
        http::Method::GET => ApiRoute::GetData(provider_id),
        http::Method::PUT => ApiRoute::PutData(provider_id),
        _ => ApiRoute::MethodNotAllowed,
    }
}

/// Whether a provider ID is one safe path segment and a clear stable key.
///
/// Provider IDs begin with a lowercase ASCII letter or digit, contain at most
/// 64 characters, and may additionally contain `.`, `_`, or `-` after the
/// first character. Rejecting percent escapes and separators keeps the file
/// mapping independent from URL-decoding and path-normalization behavior.
fn is_valid_provider_id(provider_id: &str) -> bool {
    let Some(first) = provider_id.bytes().next() else { return false; };
    provider_id.len() <= 64 &&
        (first.is_ascii_lowercase() || first.is_ascii_digit()) &&
        provider_id.bytes().skip(1).all(|byte|
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-'))
}

/// Build a plain-text routing error response.
fn text_error(status: u16, message: &str) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(message.to_owned().into_bytes())
        .expect("valid error response")
}

/// Build the data endpoint's method rejection with its required method list.
fn method_not_allowed() -> http::Response<Vec<u8>> {
    let mut response = text_error(405, "method not allowed");
    response
        .headers_mut()
        .insert(http::header::ALLOW, http::HeaderValue::from_static("GET, PUT"));
    response
}

#[cfg(test)]
mod tests {
    use http::Method;

    use super::classify_route;
    use super::method_not_allowed;
    use super::ApiRoute;

    #[test]
    fn data_get_accepts_provider_identifier() {
        assert_eq!(
            classify_route(&Method::GET, "/api/data/rust"),
            ApiRoute::GetData("rust"));
    }

    #[test]
    fn data_put_accepts_namespaced_provider_identifier() {
        assert_eq!(
            classify_route(&Method::PUT, "/api/data/cpp.cppreference"),
            ApiRoute::PutData("cpp.cppreference"));
    }

    #[test]
    fn data_route_rejects_unsupported_method() {
        assert_eq!(
            classify_route(&Method::POST, "/api/data/rust"),
            ApiRoute::MethodNotAllowed);
    }

    #[test]
    fn method_rejection_advertises_supported_methods() {
        let response = method_not_allowed();
        assert_eq!(response.headers()[http::header::ALLOW], "GET, PUT");
    }

    #[test]
    fn data_route_rejects_empty_provider_identifier() {
        assert_eq!(
            classify_route(&Method::GET, "/api/data/"),
            ApiRoute::InvalidProviderId);
    }

    #[test]
    fn data_route_rejects_path_separator() {
        assert_eq!(
            classify_route(&Method::GET, "/api/data/rust/extra"),
            ApiRoute::InvalidProviderId);
    }

    #[test]
    fn data_route_rejects_percent_escape() {
        assert_eq!(
            classify_route(&Method::GET, "/api/data/rust%2Fextra"),
            ApiRoute::InvalidProviderId);
    }

    #[test]
    fn data_route_rejects_uppercase_provider_identifier() {
        assert_eq!(
            classify_route(&Method::GET, "/api/data/Rust"),
            ApiRoute::InvalidProviderId);
    }

    #[test]
    fn data_route_rejects_overlong_provider_identifier() {
        let path = format!("/api/data/{}", "a".repeat(65));
        assert_eq!(
            classify_route(&Method::GET, &path),
            ApiRoute::InvalidProviderId);
    }

    #[test]
    fn data_prefix_trap_is_not_a_route() {
        assert_eq!(
            classify_route(&Method::GET, "/api/database"),
            ApiRoute::NotFound);
    }

    #[test]
    fn retired_versioned_route_is_not_found() {
        assert_eq!(
            classify_route(&Method::GET, "/api/v1/data/rust"),
            ApiRoute::NotFound);
    }
}
