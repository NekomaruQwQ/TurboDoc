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

/// Route a classified request to persistence storage or a protocol error.
async fn route(
    state: &AppState,
    method: &http::Method,
    path: &str,
    body: &[u8]) -> http::Response<Vec<u8>> {
    match classify_route(method, path) {
        ApiRoute::GetData(data_id) => data::get_data(state, data_id).await,
        ApiRoute::PutData(data_id) => data::put_data(state, data_id, body).await,
        ApiRoute::GetSource(source_id) => data::get_source(state, source_id).await,
        ApiRoute::PutSource(source_id) => data::put_source(state, source_id, body).await,
        ApiRoute::MethodNotAllowed => method_not_allowed(),
        ApiRoute::InvalidDataId => text_error(400, "invalid data id"),
        ApiRoute::InvalidSourceId => text_error(400, "invalid source id"),
        ApiRoute::NotFound => text_error(404, "not found"),
    }
}

/// Classified Rust API route with its validated dynamic data.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ApiRoute<'a> {
    /// Generic data read carrying a filesystem-safe ID.
    GetData(&'a str),
    /// Generic data write carrying a filesystem-safe ID.
    PutData(&'a str),
    /// Per-source read carrying a filesystem-safe source ID.
    GetSource(&'a str),
    /// Per-source write carrying a filesystem-safe source ID.
    PutSource(&'a str),
    /// Known persistence route requested with a method other than GET or PUT.
    MethodNotAllowed,
    /// Data-shaped route whose ID violates the identifier contract.
    InvalidDataId,
    /// Source-shaped route whose ID violates the identifier contract.
    InvalidSourceId,
    /// Any API path not implemented by Rust.
    NotFound,
}

/// Classify a Rust-owned API request and validate its resource identifier.
fn classify_route<'a>(method: &http::Method, path: &'a str) -> ApiRoute<'a> {
    let (resource_id, read, write, invalid) =
        if let Some(data_id) = path.strip_prefix("/api/data/") {
            (data_id, ApiRoute::GetData(data_id), ApiRoute::PutData(data_id),
                ApiRoute::InvalidDataId)
        } else if let Some(source_id) = path.strip_prefix("/api/sources/") {
            (source_id, ApiRoute::GetSource(source_id), ApiRoute::PutSource(source_id),
                ApiRoute::InvalidSourceId)
        } else {
            return ApiRoute::NotFound;
        };
    if !is_valid_resource_id(resource_id) {
        return invalid;
    }
    match *method {
        http::Method::GET => read,
        http::Method::PUT => write,
        _ => ApiRoute::MethodNotAllowed,
    }
}

/// Whether a persistence ID is one safe path segment and a clear stable key.
///
/// Persistence IDs begin with a lowercase ASCII letter or digit, contain at most
/// 64 characters, and may additionally contain `.`, `_`, or `-` after the
/// first character. Rejecting percent escapes and separators keeps the file
/// mapping independent from URL-decoding and path-normalization behavior.
fn is_valid_resource_id(resource_id: &str) -> bool {
    let Some(first) = resource_id.bytes().next() else { return false; };
    resource_id.len() <= 64 &&
        (first.is_ascii_lowercase() || first.is_ascii_digit()) &&
        resource_id.bytes().skip(1).all(|byte|
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

/// Build the persistence endpoints' rejection with their required method list.
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
    fn data_get_accepts_resource_identifier() {
        assert_eq!(
            classify_route(&Method::GET, "/api/data/rust"),
            ApiRoute::GetData("rust"));
    }

    #[test]
    fn data_put_accepts_namespaced_resource_identifier() {
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
    fn data_route_rejects_empty_resource_identifier() {
        assert_eq!(
            classify_route(&Method::GET, "/api/data/"),
            ApiRoute::InvalidDataId);
    }

    #[test]
    fn data_route_rejects_path_separator() {
        assert_eq!(
            classify_route(&Method::GET, "/api/data/rust/extra"),
            ApiRoute::InvalidDataId);
    }

    #[test]
    fn data_route_rejects_percent_escape() {
        assert_eq!(
            classify_route(&Method::GET, "/api/data/rust%2Fextra"),
            ApiRoute::InvalidDataId);
    }

    #[test]
    fn data_route_rejects_uppercase_resource_identifier() {
        assert_eq!(
            classify_route(&Method::GET, "/api/data/Rust"),
            ApiRoute::InvalidDataId);
    }

    #[test]
    fn data_route_rejects_overlong_resource_identifier() {
        let path = format!("/api/data/{}", "a".repeat(65));
        assert_eq!(
            classify_route(&Method::GET, &path),
            ApiRoute::InvalidDataId);
    }

    #[test]
    fn data_prefix_trap_is_not_a_route() {
        assert_eq!(
            classify_route(&Method::GET, "/api/database"),
            ApiRoute::NotFound);
    }

    #[test]
    fn source_get_accepts_source_identifier() {
        assert_eq!(
            classify_route(&Method::GET, "/api/sources/rust-crates"),
            ApiRoute::GetSource("rust-crates"));
    }

    #[test]
    fn source_put_accepts_source_identifier() {
        assert_eq!(
            classify_route(&Method::PUT, "/api/sources/rust-book"),
            ApiRoute::PutSource("rust-book"));
    }

    #[test]
    fn source_route_rejects_path_separator() {
        assert_eq!(
            classify_route(&Method::GET, "/api/sources/rust/extra"),
            ApiRoute::InvalidSourceId);
    }

    #[test]
    fn source_route_rejects_uppercase_identifier() {
        assert_eq!(
            classify_route(&Method::GET, "/api/sources/Rust"),
            ApiRoute::InvalidSourceId);
    }

    #[test]
    fn source_prefix_trap_is_not_a_route() {
        assert_eq!(
            classify_route(&Method::GET, "/api/source/rust"),
            ApiRoute::NotFound);
    }

    #[test]
    fn retired_versioned_route_is_not_found() {
        assert_eq!(
            classify_route(&Method::GET, "/api/v1/data/rust"),
            ApiRoute::NotFound);
    }
}
