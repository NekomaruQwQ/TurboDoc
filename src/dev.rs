//! Development frontend lifecycle.
//!
//! Dev mode owns the Vite child process, its launch-token readiness probe,
//! and the Windows Job Object that prevents orphaned child processes. None of
//! this module is constructed in release mode.

use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;
use std::time::Instant;

use anyhow::Context as _;
use tokio::process::Command;

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
/// Response header that proves `/api/ready` belongs to the child just spawned.
const READY_TOKEN_HEADER: &str = "x-turbodoc-vite-ready-token";

/// Lifecycle notifications from the host-owned Vite child.
pub enum Event {
    /// Vite answered the dedicated HTTP readiness endpoint and can receive the
    /// initial WebView2 navigation.
    Ready,
    /// Vite failed before readiness or exited later. Every child exit is
    /// fatal because the development frontend depends on that process.
    Exited(anyhow::Error),
}

/// Prepared development frontend and the resources that own its lifetime.
pub struct Frontend {
    runtime: tokio::runtime::Handle,
    root_dir: PathBuf,
    origin: String,
    port: u16,
    job_object: win32job::Job,
}

impl Frontend {
    /// Resolve the repository frontend and configure child-process cleanup.
    ///
    /// `executable_path` must have Cargo's `<repo>/target/<profile>/<exe>`
    /// layout because Vite runs from the repository's `frontend/` directory.
    ///
    /// # Errors
    ///
    /// Returns an error when the executable path has an unexpected layout or
    /// Windows cannot create and assign the process Job Object.
    pub fn new(
        runtime: tokio::runtime::Handle,
        executable_path: &Path,
        port: u16)
     -> anyhow::Result<Self> {
        let root_dir = repo_root_from_executable(executable_path)
            .context("development mode requires an executable under <repo>/target/<profile>")?;
        let job_object = create_job_object()?;
        log::info!("dev frontend root: {}", root_dir.display());
        Ok(Self {
            runtime,
            root_dir,
            origin: format!("http://127.0.0.1:{port}"),
            port,
            job_object,
        })
    }

    /// Return the IPv4 loopback origin shared by Vite and WebView2.
    pub fn origin(&self) -> &str { &self.origin }

    /// Spawn and monitor Vite on the prepared Tokio runtime.
    ///
    /// The detached task owns the Job Object and child handle until Vite exits
    /// or runtime shutdown cancels the task. `on_event` first receives
    /// [`Event::Ready`], then receives [`Event::Exited`] for any later exit.
    pub fn spawn<F>(self, startup: StartupProbe, on_event: F)
    where
        F: FnMut(Event) + Send + 'static {
        let Self {
            runtime,
            root_dir,
            origin: _,
            port,
            job_object,
        } = self;
        let _task = runtime.spawn(async move {
            // The current process was assigned before Vite spawned. Retaining
            // the final handle keeps kill-on-close active for the child.
            let _job_object = job_object;
            monitor_vite(&root_dir, port, startup, on_event).await;
        });
    }
}

/// Own and monitor Vite for the lifetime of the child process.
async fn monitor_vite<F>(
    root_dir: &Path,
    port: u16,
    startup: StartupProbe,
    mut on_event: F)
where
    F: FnMut(Event) {
    if let Err(err) = run_vite(root_dir, port, startup, &mut on_event).await {
        on_event(Event::Exited(err));
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
    F: FnMut(Event) {
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
    on_event(Event::Ready);

    let status = child
        .wait()
        .await
        .context("failed to wait for Vite after startup")?;
    unexpected_exit(status)
}

/// Convert every Vite exit into an error because dev mode cannot serve its UI
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
    let url = format!("http://127.0.0.1:{port}/api/ready");

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

/// Create a kill-on-close Job Object and assign the current host process.
fn create_job_object() -> anyhow::Result<win32job::Job> {
    use tap::Pipe as _;
    use win32job::ExtendedLimitInfo;
    use win32job::Job;

    let job_object =
        ExtendedLimitInfo::new()
            .limit_kill_on_job_close()
            .pipe(|info| Job::create_with_limit_info(info))
            .context("failed to create development process Job Object")?;
    job_object
        .assign_current_process()
        .context("failed to assign TurboDoc to the development process Job Object")?;
    Ok(job_object)
}

/// Walk from Cargo's executable layout to the repository root.
fn repo_root_from_executable(executable_path: &Path) -> Option<PathBuf> {
    executable_path
        .parent()?
        .parent()?
        .parent()
        .map(Path::to_path_buf)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::create_ready_token;
    use super::is_ready_response;
    use super::repo_root_from_executable;

    #[test]
    fn repo_root_is_derived_from_cargo_executable_layout() {
        assert_eq!(
            repo_root_from_executable(Path::new(
                r"D:\repo\target\release\turbodoc.exe")),
            Some(Path::new(r"D:\repo").to_path_buf()));
    }

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
