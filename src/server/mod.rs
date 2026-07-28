//! In-process TurboDoc backend.
//!
//! Opens the SQLite cache and returns a [`Server`] handle. The host uses that
//! handle to spawn Vite concurrently with native-window creation, then its
//! WebView2 navigates to Vite and routes intercepted requests through the
//! handle:
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
mod db;
mod frontend;
mod proxy;
mod state;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use dashmap::DashSet;

use crate::prelude::*;
use crate::startup::StartupProbe;
use self::db::Database;
use self::state::AppState;

/// User-Agent for all upstream HTTP requests. Identifies TurboDoc to remote
/// sites and is bumped alongside the host version.
pub(crate) const USER_AGENT: &str = "TurboDoc/0.4 (documentation viewer)";

/// In-process backend configuration. Built from the host's CLI args.
pub struct Config {
    /// Runtime data directory. Houses provider TOML files and the
    /// `cache.sqlite` database. Created on startup if it doesn't exist.
    pub data_dir: PathBuf,
}

/// Vite child-process configuration. Kept separate from [`Config`] because
/// frontend startup runs concurrently with eframe and WebView2 initialization.
pub struct FrontendConfig {
    /// Port Vite binds to and the WebView2 navigates to.
    pub port: u16,
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
    /// Schedule Vite startup on the Tokio runtime and invoke `on_ready` after
    /// the port accepts connections or startup fails.
    ///
    /// Dropping the returned Tokio task handle intentionally detaches the
    /// task. Its result is delivered exactly once through `on_ready`, which
    /// the native host consumes from eframe's startup coordinator.
    pub fn spawn_frontend<F>(
        &self,
        config: FrontendConfig,
        startup: StartupProbe,
        on_ready: F)
    where
        F: FnOnce(anyhow::Result<()>) + Send + 'static {
        let _task = self.runtime.spawn(async move {
            let result =
                frontend::spawn_vite(&config.root_dir, config.port, startup)
                    .await;
            on_ready(result);
        });
    }

    /// Fetch `request` through the proxy pipeline (cache lookup, upstream
    /// fetch on miss, dark-mode injection). Request cache directives are
    /// honored, so callers can explicitly bypass a cached response.
    /// Blocks the calling thread until the response is ready.
    ///
    /// MUST NOT be called from a tokio worker thread — would panic via
    /// `Handle::block_on`. The WebView2 callback runs on the main UI
    /// thread, which satisfies this.
    pub fn fetch(&self, request: &WebRequest) -> anyhow::Result<WebResponse> {
        self.runtime.block_on(proxy::fetch(&self.state, request))
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

/// Build the shared backend state and return a [`Server`] handle. Frontend
/// startup is deliberately separate so the host can overlap it with WebView2.
pub async fn start(config: Config, startup: StartupProbe) -> anyhow::Result<Server> {
    let phase_started_at = Instant::now();

    // Match the former server's `mkdirSync(dataDir, { recursive: true })`.
    fs::create_dir_all(&config.data_dir)?;

    let state = AppState {
        db: Database::open(&config.data_dir)?,
        data_dir: Arc::new(config.data_dir),
        http_client: build_http_client()?,
        revalidating: Arc::new(DashSet::new()),
    };

    startup.mark_phase("in-process backend ready", phase_started_at);

    Ok(Server {
        state,
        runtime: tokio::runtime::Handle::current(),
    })
}

/// Shared HTTP client for upstream proxy requests. Redirect handling is off
/// because the proxy forwards 3xx responses to WebView2 unchanged (matching
/// the former `redirect: "manual"` behavior in the Bun server).
fn build_http_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
}
