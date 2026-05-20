//! Vite dev-server child process. Spawned by `server::start` on the main
//! port; the WebView2 host navigates to `http://localhost:{port}/`
//! directly, with no Rust reverse proxy in between.
//!
//! Job-Object inheritance (set up in `main.rs`) means the spawned Vite
//! process dies when the host exits, including abrupt terminations.

use std::path::Path;
use std::time::Duration;
use std::time::Instant;

use tokio::net::TcpStream;
use tokio::process::Command;

/// Spawn Vite on `port`. Returns once Vite is accepting TCP connections so
/// the WebView2 navigation that follows doesn't race the dev server's
/// startup.
pub async fn spawn_vite(root_dir: &Path, port: u16) -> anyhow::Result<()> {
    let frontend_dir = root_dir.join("frontend");
    log::info!("spawning vite dev on port {port}...");
    let child =
        Command::new("bunx")
            .args(["--bun", "vite", "dev"])
            .current_dir(&frontend_dir)
            .env("TURBODOC_VITE_PORT", port.to_string())
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit())
            .spawn()?;

    // Tokio's `Child` doesn't kill the process on Drop by default, but it
    // does release the kernel handle, which means we lose the ability to
    // reap the child cleanly. Leak the Child so its handle survives for the
    // lifetime of the host; the Job Object kills Vite when we exit.
    Box::leak(Box::new(child));

    wait_for_port(port, Duration::from_secs(30)).await?;
    log::info!("vite dev ready on port {port}");
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
