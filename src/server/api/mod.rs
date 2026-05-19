//! `/api/v1` router. Hosts the data-persistence and crates-metadata routes
//! and applies the per-request log middleware (matching the former Hono
//! `c.req.method c.req.path -> c.res.status (Content-Type)` format).

mod crates;
mod data;

use axum::Router;
use axum::body::Body;
use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;
use axum::routing::get;
use axum::routing::post;

use crate::server::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/data/{file_name}",
            get(data::get_data).put(data::put_data))
        .route("/crates", post(crates::post_crates))
        .layer(axum::middleware::from_fn(log_request))
}

/// Per-request access log. Format matches the former Hono middleware so
/// existing log-watching habits keep working.
async fn log_request(req: Request<Body>, next: Next) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_owned();
    let res = next.run(req).await;
    let status = res.status().as_u16();
    let content_type =
        res.headers()
            .get(http::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
    log::info!("{method} {path} -> {status} ({content_type})");
    res
}
