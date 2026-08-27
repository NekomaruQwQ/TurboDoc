//! Shared state used by the in-process persistence and proxy handlers.
//!
//! Every field is `Arc`-shaped (or internally reference-counted, like
//! `reqwest::Client`) so background cache revalidation can cheaply retain the
//! resources it needs without a network-server state wrapper.

use std::path::PathBuf;
use std::sync::Arc;

use dashmap::DashSet;

use crate::server::db::Database;

/// Cloneable resources shared by all in-process backend operations.
#[derive(Clone)]
pub struct AppState {
    /// Persistent HTTP cache shared by proxy requests and revalidation tasks.
    pub db: Arc<Database>,
    /// Configured runtime root for generic and per-source TOML resources.
    pub data_dir: Arc<PathBuf>,
    /// Async client shared by all proxy upstream requests. Built once with
    /// the canonical User-Agent and a manual-redirect policy so the proxy
    /// can forward 3xx responses unchanged to WebView2.
    pub http_client: reqwest::Client,
    /// URLs that currently have a background revalidation in flight.
    /// Insertion returns false when an entry already exists, which the proxy
    /// uses to dedupe — no two tasks revalidate the same URL concurrently.
    pub revalidating: Arc<DashSet<String>>,
}
