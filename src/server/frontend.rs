//! Vite dev-server child process. Spawned on the Tokio runtime concurrently
//! with native WebView2 setup; the host navigates only after Vite answers its
//! dedicated HTTP readiness endpoint.
//!
//! Job-Object inheritance (set up in `main.rs`) means the spawned Vite
//! process dies when the host exits, including abrupt terminations.

use std::path::Path;
use std::time::Duration;
use std::time::Instant;

use anyhow::Context as _;
use tokio::process::Command;

use super::FrontendEvent;
use crate::startup::StartupProbe;

/// Maximum time allowed for Vite to answer its readiness endpoint.
const VITE_STARTUP_TIMEOUT: Duration = Duration::from_secs(5);
/// Each HTTP attempt is shorter than the total deadline so a stalled response
/// cannot consume the entire startup budget without another attempt.
const READINESS_REQUEST_TIMEOUT: Duration = Duration::from_millis(500);
/// Startup-only polling cadence; this is intentionally modest rather than a
/// hot-path optimization.
const READINESS_RETRY_INTERVAL: Duration = Duration::from_millis(100);
/// Environment variable carrying the identity of one Vite launch.
const READY_TOKEN_ENV: &str = "TURBODOC_VITE_READY_TOKEN";
/// Response header that proves `/ready` belongs to the child just spawned.
const READY_TOKEN_HEADER: &str = "x-turbodoc-vite-ready-token";

/// Own and monitor Vite for the lifetime of the child process.
///
/// `on_event` first receives [`FrontendEvent::Ready`] after `GET /ready`
/// returns an empty `200` response carrying this launch's token. Any later
/// child exit is unexpected and is reported through
/// [`FrontendEvent::Exited`], including an exit status of zero. Token
/// generation, startup timeout, and child-launch failures use the same path.
pub async fn monitor_vite<F>(
    root_dir: &Path,
    port: u16,
    startup: StartupProbe,
    mut on_event: F)
where
    F: FnMut(FrontendEvent) {
    if let Err(err) = run_vite(root_dir, port, startup, &mut on_event).await {
        on_event(FrontendEvent::Exited(err));
    }
}

/// Run Vite until it exits. The child handle stays owned so the process can be
/// reaped and its exit status can be surfaced to the native host.
async fn run_vite<F>(
    root_dir: &Path,
    port: u16,
    startup: StartupProbe,
    on_event: &mut F)
 -> anyhow::Result<()>
where
    F: FnMut(FrontendEvent) {
    let phase_started_at = Instant::now();
    let frontend_dir = root_dir.join("frontend");
    let ready_token = create_ready_token()?;
    startup.mark("Vite task started");
    let mut child =
        Command::new("bunx")
            .args(["--bun", "vite", "dev"])
            .current_dir(&frontend_dir)
            .env("TURBODOC_VITE_PORT", port.to_string())
            .env(READY_TOKEN_ENV, &ready_token)
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit())
            // Cancellation during host shutdown or readiness failure must not
            // orphan a dev server outside the normal Job-Object exit path.
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("failed to spawn Vite in {}", frontend_dir.display()))?;
    startup.mark("Vite child spawned");

    let readiness = wait_for_ready(port, &ready_token, VITE_STARTUP_TIMEOUT);
    tokio::pin!(readiness);
    tokio::select! {
        biased;
        status = child.wait() =>
            return unexpected_exit(status.context("failed to wait for Vite during startup")?),
        result = &mut readiness => result?,
    }
    startup.mark_phase(
        &format!("Vite ready on port {port}"),
        phase_started_at);
    on_event(FrontendEvent::Ready);

    let status = child
        .wait()
        .await
        .context("failed to wait for Vite after startup")?;
    unexpected_exit(status)
}

/// Convert every Vite exit into an error because TurboDoc cannot serve its UI
/// without the child, regardless of whether the process reports success.
fn unexpected_exit(status: std::process::ExitStatus) -> anyhow::Result<()> {
    anyhow::bail!("Vite exited unexpectedly with status {status}")
}

/// Create a collision-resistant identity for one host-managed Vite launch.
///
/// The value distinguishes a newly spawned child from a stale Vite process;
/// it is not an authentication secret.
fn create_ready_token() -> anyhow::Result<String> {
    // SAFETY: `CoCreateGuid` has no caller-provided pointer or initialization
    // requirement; the windows crate owns and validates its output storage.
    let guid = unsafe { windows::Win32::System::Com::CoCreateGuid() }
        .context("failed to create the Vite readiness token")?;
    Ok(format!("{:032x}", guid.to_u128()))
}

/// Wait until Vite proves HTTP middleware readiness, not merely that some
/// process has opened the configured TCP port. A response from an older
/// TurboDoc Vite instance is ignored because its token cannot match.
async fn wait_for_ready(
    port: u16,
    ready_token: &str,
    timeout: Duration)
 -> anyhow::Result<()> {
    let client = reqwest::Client::builder()
        // Loopback readiness must not be redirected through a configured
        // system proxy, which could manufacture a misleading response.
        .no_proxy()
        .timeout(READINESS_REQUEST_TIMEOUT)
        .build()
        .context("failed to build the Vite readiness client")?;
    let url = format!("http://127.0.0.1:{port}/ready");

    let poll = async {
        loop {
            if let Ok(response) = client.get(&url).send().await {
                let status = response.status();
                let token_matches = response
                    .headers()
                    .get(READY_TOKEN_HEADER)
                    .is_some_and(|value| value.as_bytes() == ready_token.as_bytes());
                if let Ok(body) = response.bytes().await
                    && is_ready_response(status, &body, token_matches)
                {
                    return;
                }
            }
            tokio::time::sleep(READINESS_RETRY_INTERVAL).await;
        }
    };

    tokio::time::timeout(timeout, poll)
        .await
        .with_context(|| format!(
            "Vite did not return an empty 200 with the expected readiness token from {url} within {timeout:?}"))?;
    Ok(())
}

/// Validate the endpoint contract separately from the transport so status,
/// body, and child-identity edge cases remain explicit and unit tested.
fn is_ready_response(
    status: reqwest::StatusCode,
    body: &[u8],
    token_matches: bool)
 -> bool {
    status == reqwest::StatusCode::OK && body.is_empty() && token_matches
}

#[cfg(test)]
mod tests {
    use super::create_ready_token;
    use super::is_ready_response;

    #[test]
    fn readiness_accepts_empty_success_with_matching_token() {
        assert!(is_ready_response(reqwest::StatusCode::OK, b"", true));
    }

    #[test]
    fn readiness_rejects_wrong_status() {
        assert!(!is_ready_response(
            reqwest::StatusCode::NO_CONTENT,
            b"",
            true));
    }

    #[test]
    fn readiness_rejects_nonempty_body() {
        assert!(!is_ready_response(
            reqwest::StatusCode::OK,
            b"ready",
            true));
    }

    #[test]
    fn readiness_rejects_stale_or_missing_token() {
        assert!(!is_ready_response(reqwest::StatusCode::OK, b"", false));
    }

    #[test]
    fn ready_token_is_128_bit_lowercase_hex() {
        let token = create_ready_token().expect("Windows should create a readiness GUID");

        assert!(token.len() == 32
            && token.bytes().all(|byte|
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
    }
}
