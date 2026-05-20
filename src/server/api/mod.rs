//! `/api/v1` request dispatcher. Called from the host's WebView2
//! `WebResourceRequested` callback (via [`crate::server::Server::dispatch_api`])
//! whenever the intercepted URL's path starts with `/api/v1/`.
//!
//! Replaces the former axum router + Hono-format access-log middleware.
//! The log format is preserved for habit's sake.

mod crates;
mod data;

use crate::prelude::*;
use crate::server::state::AppState;

/// Dispatch an intercepted `/api/v1/*` request to the matching handler.
/// Always returns a response — internal errors are turned into 4xx/5xx
/// JSON bodies inside the handlers, never propagated as panics.
///
/// Logs each request in `<METHOD> <PATH> -> <STATUS> (<CTYPE>)` format,
/// matching the former axum middleware.
pub async fn dispatch(state: &AppState, req: WebRequest) -> http::Response<Vec<u8>> {
    let method = req.method().clone();
    let path = req.uri().path().to_owned();
    let query = req.uri().query().unwrap_or("").to_owned();
    let body = req.into_body();

    let response = route(state, &method, &path, &query, &body).await;

    let status = response.status().as_u16();
    let content_type =
        response.headers()
            .get(http::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
    log::info!("{method} {path} -> {status} ({content_type})");

    response
}

async fn route(
    state: &AppState,
    method: &http::Method,
    path: &str,
    query: &str,
    body: &[u8],
) -> http::Response<Vec<u8>> {
    let Some(suffix) = path.strip_prefix("/api/v1/") else {
        return text_error(404, "not found");
    };

    if let Some(file_name) = suffix.strip_prefix("data/") {
        return match *method {
            http::Method::GET => data::get(state, file_name).await,
            http::Method::PUT => data::put(state, file_name, body).await,
            _ => text_error(405, "method not allowed"),
        };
    }

    if suffix == "crates" {
        return match *method {
            http::Method::POST => crates::post(state, query, body).await,
            _ => text_error(405, "method not allowed"),
        };
    }

    text_error(404, "not found")
}

fn text_error(status: u16, message: &str) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(message.to_owned().into_bytes())
        .expect("valid error response")
}
