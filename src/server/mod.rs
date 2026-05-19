//! In-process TurboDoc server.
//!
//! Replaces the former Bun + Hono server with axum running on the host's
//! tokio runtime. Exposes the same HTTP surface (`/api/v1/*`, `/proxy`,
//! frontend assets) so the WebView2 frontend keeps working unchanged.

mod api;
mod crates_cache;
mod db;
mod frontend;
mod proxy;
mod state;

use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use dashmap::DashSet;

use self::db::Database;
use self::state::AppState;

/// User-Agent for all upstream HTTP requests (proxy + crates.io). Required by
/// the crates.io crawler policy (https://crates.io/policies) and good practice
/// elsewhere. Bumped alongside the host version.
pub(crate) const USER_AGENT: &str = "TurboDoc/0.4 (documentation viewer)";

/// Offset added to the main port to derive the Vite dev port: `vite_port =
/// port + VITE_PORT_OFFSET`. Matches the offset the former in-process Vite
/// used for HMR, so anyone with `localhost:<port+10000>` in their notes
/// (HMR debugging URLs, mostly) sees the same number.
const VITE_PORT_OFFSET: u16 = 10000;

/// Server configuration. Built from the host's CLI args in `main.rs`.
pub struct Config {
    pub port: u16,
    /// Runtime data directory. Houses provider TOML files and the
    /// `cache.sqlite` database. Created on startup if it doesn't exist.
    pub data_dir: PathBuf,
    /// Repo root. Used to locate `frontend/dist/` (prod) and `frontend/`
    /// (dev, working dir for Vite).
    pub root_dir: PathBuf,
    /// `true` → spawn Vite + reverse-proxy. `false` → serve `frontend/dist/`.
    pub dev: bool,
}

/// Build the shared state, bind to `127.0.0.1:{port}`, and spawn the
/// request-handling loop onto the current tokio runtime. Returns once the
/// listener is accepting connections, so the host can launch WebView2 without
/// polling for readiness.
///
/// In `--dev` mode this also spawns Vite as a child process and waits for
/// it to accept connections before returning — that way the very first
/// frontend request through the reverse proxy doesn't race Vite's startup.
///
/// The serving task runs until the tokio runtime is dropped (i.e. process
/// exit). Any error from `axum::serve` is logged and the task ends silently —
/// the host has no way to react to a server crash other than appearing broken.
pub async fn start(config: Config) -> anyhow::Result<()> {
    // Match the former server's `mkdirSync(dataDir, { recursive: true })`.
    fs::create_dir_all(&config.data_dir)?;

    let state = AppState {
        db: Database::open(&config.data_dir)?,
        data_dir: Arc::new(config.data_dir),
        http_client: build_http_client()?,
        revalidating: Arc::new(DashSet::new()),
    };

    let vite_port = config.port + VITE_PORT_OFFSET;
    if config.dev {
        frontend::spawn_vite(&config.root_dir, vite_port).await?;
    }

    let addr = format!("127.0.0.1:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    log::info!("server bound to {}", listener.local_addr()?);

    let app = build_router(state, &config.root_dir, config.dev, vite_port);
    tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, app).await {
            log::error!("server task ended with error: {err}");
        }
    });
    Ok(())
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

fn build_router(state: AppState, root_dir: &Path, dev: bool, vite_port: u16) -> Router {
    let routes: Router<AppState> =
        Router::new()
            .nest("/api/v1", api::router())
            .nest("/proxy", proxy::router());

    if dev {
        // Capture a clone of the http client so the closure stays `'static`
        // and the resulting Router doesn't need extra state plumbing for
        // the dev-only reverse proxy.
        let client = state.http_client.clone();
        routes
            .fallback(move |req| {
                let client = client.clone();
                async move { frontend::reverse_proxy(client, vite_port, req).await }
            })
            .with_state(state)
    } else {
        routes
            .fallback_service(frontend::prod_service(root_dir))
            .with_state(state)
    }
}
