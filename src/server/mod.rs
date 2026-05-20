//! In-process TurboDoc backend.
//!
//! Spawns Vite as a child process on the main port, opens the SQLite cache,
//! and returns a [`Server`] handle. The host's WebView2 navigates to
//! `http://localhost:{port}/` (= Vite) and routes intercepted requests
//! through the handle:
//!
//! - **Docs URLs** (`PROXIED_URL` prefixes) → [`Server::fetch`] → proxy
//!   pipeline with caching + dark-mode injection.
//! - **`/api/v1/*`** → [`Server::dispatch_api`] → data persistence + crates
//!   metadata.
//! - **Everything else** → passed through to Vite (frontend assets, HMR).
//!
//! There is no axum, no bound TCP listener of our own — only the Vite
//! child process is on the network.

mod api;
mod crates_metadata;
mod db;
mod frontend;
mod proxy;
mod state;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use dashmap::DashSet;

use crate::prelude::*;
use self::db::Database;
use self::state::AppState;

/// User-Agent for all upstream HTTP requests (proxy + crates.io). Required by
/// the crates.io crawler policy (https://crates.io/policies) and good practice
/// elsewhere. Bumped alongside the host version.
pub(crate) const USER_AGENT: &str = "TurboDoc/0.4 (documentation viewer)";

/// Server configuration. Built from the host's CLI args in `main.rs`.
pub struct Config {
    /// Port Vite binds to and the WebView2 navigates to.
    pub port: u16,
    /// Runtime data directory. Houses provider TOML files and the
    /// `cache.sqlite` database. Created on startup if it doesn't exist.
    pub data_dir: PathBuf,
    /// Repo root. Used to locate `frontend/` (Vite's working directory).
    pub root_dir: PathBuf,
}

/// Host-side handle for invoking the backend without an HTTP round trip.
/// Returned by [`start`]; the WebView2 `WebResourceRequested` callback
/// calls methods on this from the UI thread.
pub struct Server {
    state: AppState,
    runtime: tokio::runtime::Handle,
}

impl Server {
    /// Fetch `url` through the proxy pipeline (cache lookup, upstream
    /// fetch on miss, dark-mode injection). Blocks the calling thread
    /// until the response is ready.
    ///
    /// MUST NOT be called from a tokio worker thread — would panic via
    /// `Handle::block_on`. The WebView2 callback runs on the main UI
    /// thread, which satisfies this.
    pub fn fetch(&self, url: &str) -> anyhow::Result<WebResponse> {
        self.runtime.block_on(proxy::fetch(&self.state, url, Default::default()))
    }

    /// Dispatch an intercepted `/api/v1/*` request to the matching
    /// in-process handler. Always returns a response — errors are
    /// converted to 4xx/5xx JSON bodies inside the handler.
    ///
    /// Same thread-safety constraint as [`Self::fetch`].
    pub fn dispatch_api(&self, req: WebRequest) -> WebResponse {
        self.runtime.block_on(api::dispatch(&self.state, req))
    }
}

/// Build the shared state, spawn Vite, and return a [`Server`] handle. The
/// host then launches WebView2 and navigates to `http://localhost:{port}/`.
pub async fn start(config: Config) -> anyhow::Result<Server> {
    // Match the former server's `mkdirSync(dataDir, { recursive: true })`.
    fs::create_dir_all(&config.data_dir)?;

    let state = AppState {
        db: Database::open(&config.data_dir)?,
        data_dir: Arc::new(config.data_dir),
        http_client: build_http_client()?,
        revalidating: Arc::new(DashSet::new()),
    };

    frontend::spawn_vite(&config.root_dir, config.port).await?;

    Ok(Server {
        state,
        runtime: tokio::runtime::Handle::current(),
    })
}

/// Shared HTTP client for the proxy and crates routes. Redirect handling is
/// off because the proxy forwards 3xx responses to WebView2 unchanged
/// (matching the former `redirect: "manual"` in the Bun server).
fn build_http_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
}
