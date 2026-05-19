//! Shared state carried by every request handler.
//!
//! `AppState` is the value passed to `Router::with_state` and extracted via
//! `axum::extract::State`. Every field is `Arc`-shaped (or itself an `Arc`
//! internally, like `reqwest::Client`) so the struct is cheap to clone, which
//! axum does on every request.

use std::path::PathBuf;
use std::sync::Arc;

use dashmap::DashSet;

use crate::server::db::Database;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub data_dir: Arc<PathBuf>,
    /// Async HTTP client for crates.io and proxy upstream requests. Built
    /// once with the canonical User-Agent and a manual-redirect policy so
    /// the proxy can forward 3xx responses unchanged to WebView2.
    pub http_client: reqwest::Client,
    /// URLs that currently have a background revalidation in flight.
    /// Insertion returns false when an entry already exists, which the proxy
    /// uses to dedupe — no two tasks revalidate the same URL concurrently.
    pub revalidating: Arc<DashSet<String>>,
}
