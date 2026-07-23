//! Vite dev-server child process. Spawned on the Tokio runtime concurrently
//! with native WebView2 setup; the host navigates only after this module
//! reports that the main port accepts connections.
//!
//! Job-Object inheritance (set up in `main.rs`) means the spawned Vite
//! process dies when the host exits, including abrupt terminations.

use std::path::Path;
use std::time::Duration;
use std::time::Instant;

use tokio::net::TcpStream;
use tokio::process::Command;

use crate::startup::StartupProbe;

/// Spawn Vite on `port`. Returns once Vite is accepting TCP connections so
/// the WebView2 navigation that follows doesn't race the dev server's
/// startup.
pub async fn spawn_vite(
    root_dir: &Path,
    port: u16,
    startup: StartupProbe)
 -> anyhow::Result<()> {
    let phase_started_at = Instant::now();
    let frontend_dir = root_dir.join("frontend");
    startup.mark("Vite task started");
    let child =
        Command::new("bunx")
            .args(["--bun", "vite", "dev"])
            .current_dir(&frontend_dir)
            .env("TURBODOC_VITE_PORT", port.to_string())
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit())
            .spawn()?;
    startup.mark("Vite child spawned");

    // Tokio's `Child` doesn't kill the process on Drop by default, but it
    // does release the kernel handle, which means we lose the ability to
    // reap the child cleanly. Leak the Child so its handle survives for the
    // lifetime of the host; the Job Object kills Vite when we exit.
    Box::leak(Box::new(child));

    wait_for_port(port, Duration::from_secs(30)).await?;
    startup.mark_phase(
        &format!("Vite ready on port {port}"),
        phase_started_at);
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
