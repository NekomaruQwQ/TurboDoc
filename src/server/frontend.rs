//! Frontend asset serving — two modes.
//!
//! **Dev** (`--dev`): spawn `bunx --bun vite dev` as a child process on
//! `vite_port = main_port + 10000`. All non-API/proxy traffic gets
//! reverse-proxied to it via [`reverse_proxy`]. HMR's WebSocket goes
//! *directly* from the browser to Vite — not through this proxy — because
//! Vite's `hmr.clientPort` config is set to `vite_port` (configured in
//! [frontend/vite.config.ts](frontend/vite.config.ts) via the
//! `TURBODOC_VITE_PORT` env var).
//!
//! **Prod** (default): tower-http's `ServeDir` serves `frontend/dist/`
//! statically, with `index.html` as the SPA fallback for unknown paths.

use std::path::Path;
use std::time::Duration;
use std::time::Instant;

use axum::body::Body;
use axum::extract::Request;
use axum::response::IntoResponse;
use axum::response::Response;
use http::StatusCode;
use tokio::net::TcpStream;
use tokio::process::Command;
use tower_http::services::ServeDir;
use tower_http::services::ServeFile;

/// Production: a tower service that serves `frontend/dist/` statically.
/// Unknown paths fall back to `index.html` for client-side routing.
pub fn prod_service(root_dir: &Path) -> ServeDir<ServeFile> {
    let dist = root_dir.join("frontend").join("dist");
    let index = dist.join("index.html");
    ServeDir::new(dist).fallback(ServeFile::new(index))
}

/// Spawn Vite on `vite_port`. The returned child inherits the host's Job
/// Object (assigned in `main.rs`) so it dies when the host exits.
///
/// Vite's config reads `TURBODOC_VITE_PORT` and uses it both as the listen
/// port and as `hmr.clientPort`, so HMR WebSocket traffic goes browser →
/// Vite directly, bypassing the Rust reverse proxy.
pub async fn spawn_vite(root_dir: &Path, vite_port: u16) -> anyhow::Result<()> {
    let frontend_dir = root_dir.join("frontend");
    log::info!("spawning vite dev on port {vite_port}...");
    let child =
        Command::new("bunx")
            .args(["--bun", "vite", "dev"])
            .current_dir(&frontend_dir)
            .env("TURBODOC_VITE_PORT", vite_port.to_string())
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit())
            .spawn()?;

    // Tokio's `Child` doesn't kill the process on Drop by default, but it
    // does release the kernel handle, which means we lose the ability to
    // reap the child cleanly. Leak the Child so its handle survives for the
    // lifetime of the host; the Job Object kills Vite when we exit.
    Box::leak(Box::new(child));

    // Wait for Vite to accept TCP connections so the first proxy request
    // doesn't race the dev server's startup.
    wait_for_port(vite_port, Duration::from_secs(30)).await?;
    log::info!("vite dev ready on port {vite_port}");
    Ok(())
}

async fn wait_for_port(port: u16, timeout: Duration) -> anyhow::Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        if TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            anyhow::bail!("port {port} did not accept connections within {timeout:?}");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// Reverse proxy handler: forwards an incoming Rust-server request to Vite
/// and returns Vite's response.
///
/// Bodies are collected eagerly via `to_bytes` rather than streamed — Vite
/// dev responses are small (HTML, ~kB; modules, ~tens of kB), so the
/// simpler synchronous shape is worth the tiny latency cost.
pub async fn reverse_proxy(
    client: reqwest::Client,
    vite_port: u16,
    req: Request,
) -> Response {
    let (parts, body) = req.into_parts();
    let body_bytes =
        match axum::body::to_bytes(body, usize::MAX).await {
            Ok(b) => b,
            Err(err) => return error(StatusCode::BAD_REQUEST, format!("read body: {err}")),
        };

    // Path + query — preserve the full target path verbatim.
    let path_and_query =
        parts.uri.path_and_query()
            .map(|pq| pq.as_str())
            .unwrap_or("/");
    let target = format!("http://127.0.0.1:{vite_port}{path_and_query}");

    let method = match reqwest::Method::from_bytes(parts.method.as_str().as_bytes()) {
        Ok(m) => m,
        Err(err) => return error(StatusCode::BAD_REQUEST, format!("bad method: {err}")),
    };
    let mut req_builder = client.request(method, &target);
    for (name, value) in parts.headers.iter() {
        // `host` would otherwise point at the public Rust port — Vite
        // rejects mismatched hosts in some scenarios. Let reqwest set it.
        if name == http::header::HOST { continue; }
        req_builder = req_builder.header(name.as_str(), value);
    }
    let upstream =
        match req_builder.body(body_bytes).send().await {
            Ok(r) => r,
            Err(err) => return error(StatusCode::BAD_GATEWAY, format!("vite unreachable: {err}")),
        };

    let status = upstream.status();
    let headers = upstream.headers().clone();
    let body =
        match upstream.bytes().await {
            Ok(b) => b,
            Err(err) => return error(StatusCode::BAD_GATEWAY, format!("read vite response: {err}")),
        };

    let mut builder = http::Response::builder().status(status);
    for (name, value) in headers.iter() {
        // `content-length` is recomputed by axum when we hand it a known-
        // length body, so forwarding the upstream value would double-set
        // the header.
        if name == http::header::CONTENT_LENGTH { continue; }
        // `transfer-encoding: chunked` doesn't survive being re-bodied as
        // `Bytes` — strip it so the response we return is internally
        // consistent.
        if name == http::header::TRANSFER_ENCODING { continue; }
        builder = builder.header(name.as_str(), value);
    }
    builder
        .body(Body::from(body))
        .map(IntoResponse::into_response)
        .unwrap_or_else(|err| error(StatusCode::INTERNAL_SERVER_ERROR, format!("build response: {err}")))
}

fn error(status: StatusCode, message: String) -> Response {
    (status, message).into_response()
}
