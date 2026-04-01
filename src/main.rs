//! TurboDoc — spawns the Bun server and hosts the frontend in a WebView2 window,
//! forwarding server output and ensuring cleanup on exit.
//!
//! Responsibilities:
//! 1. Single-instance guard: refuse to start if `lock.toml` exists in the data dir.
//! 2. Job Object: kernel-level guarantee that the server dies with the host.
//! 3. Lock file polling: wait for the server to write `lock.toml` with its port.
//! 4. Console forwarding: prefix server output with `@server`.
//! 5. Cleanup: delete `lock.toml` on exit.

mod prelude {
    pub type WebRequestBuilder = http::request::Builder;
    pub type WebRequest = http::Request<Vec<u8>>;
    pub type WebResponse = http::Response<Vec<u8>>;
}

mod app;
mod webview;

/// URL prefixes that the host can navigate to instead of opening in
/// external browser.
const HOSTED_URL: &[&str] = &[
    "https://docs.rs",
    "https://doc.rust-lang.org",
    "https://microsoft.github.io/windows-docs-rs/doc/",
];

/// URL prefixes that the host intercepts and proxies to the server,
/// instead of letting WebView2 handle them directly.
const PROXIED_URL: &[&str] = &[
    "https://docs.rs",
    "https://doc.rust-lang.org",
    "https://microsoft.github.io/windows-docs-rs/doc/",
];

fn main() {
    pretty_env_logger::init();
    main::main();
}

mod main {
    use std::path::Path;
    use std::env;
    use std::fs;
    use std::io::*;
    use std::process;
    use std::process::*;
    use std::thread;
    use std::time::{Duration, Instant};

    use tap::prelude::*;

    pub fn main() {
        let job_object = create_job_object();

        let self_path =
            env::current_exe()
                .expect("failed to get executable path");
        log::info!("executable path: {}", self_path.display());

        // The executable path is expected to be `<repo>/target/debug/turbodoc.exe`.
        // So we walk up three levels to find the repo root.
        let root_dir =
            self_path
                .pipe_as_ref(Path::parent)
                .and_then(Path::parent)
                .and_then(Path::parent)
                .map(Path::to_path_buf)
                .expect("unexpected executable path");
        let data_dir =
            root_dir.join("target/data");
        log::info!("root_dir: {}", root_dir.display());
        log::info!("data_dir: {}", data_dir.display());

        // -- Check for the single-instance lock --
        let lock_file =
            data_dir.join("lock.toml");
        log::info!("checking for lock at {} ...", lock_file.display());
        if lock_file.exists() {
            log::error!(
                "Lock file already exists at {}.\n\
                Another TurboDoc instance may be running. \
                If not, delete the file manually and try again.",
                lock_file.display());
            process::exit(1);
        }

        // -- Spawn server --
        // The server binds to $TURBODOC_PORT and writes `lock.toml` to the data dir
        // once ready. We poll for that file to confirm readiness.
        log::info!("starting server...");
        let server = spawn_server(&root_dir, &data_dir);
        let port =
            poll_lock_file(&lock_file, Duration::from_secs(10))
                .expect("server is not ready within 10 seconds timeout");
        log::info!("server ready on port {port}.");

        // -- Spawn app --
        log::info!("starting app...");
        crate::app::run(&format!("http://localhost:{port}"));

        // -- Cleanup --
        // The Job Object kills the server, but it won't get a chance to
        // remove the lock file itself, so we do it here.
        log::info!("app exited, cleaning up...");
        match fs::remove_file(&lock_file) {
            Ok(_) =>
                log::info!("lock file removed successfully"),
            Err(err) =>
                log::error!("failed to remove lock file: {err}"),
        }

        drop(server);
        drop(job_object);
    }

    /// Creates a Job Object and assigns the current process to it.
    ///
    /// This ensures that if the launcher process exits for any reason (including
    /// crashes), the OS will automatically terminate all child processes in the
    /// job, preventing orphaned server/app processes.
    fn create_job_object() -> win32job::Job {
        use tap::Pipe as _;
        use win32job::{
            Job,
            ExtendedLimitInfo,
        };

        let job_object =
            ExtendedLimitInfo::new()
                .limit_kill_on_job_close()
                .pipe(|&mut ref info| Job::create_with_limit_info(info))
                .expect("failed to create job object");
        job_object
            .assign_current_process()
            .expect("failed to assign current process to job object");
        job_object
    }

    fn spawn_server(root_dir: &Path, data_dir: &Path) -> Child {
        Command::new("bun")
            .args(["--hot", "server"])
            .current_dir(root_dir)
            .env("TURBODOC_DATA", data_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to spawn server process")
            .tap_mut(|child| forward_output(child, "@server"))
    }

    fn forward_output(child: &mut Child, tag: &'static str) {
        let stdout =
            child.stdout.take().expect("failed to capture stdout");
        let stderr =
            child.stderr.take().expect("failed to capture stderr");
        on_output(stdout, move |line| eprintln!("{tag} stdout> {line}"));
        on_output(stderr, move |line| eprintln!("{tag} stderr> {line}"));
    }

    fn on_output<R, F>(read: R, line_callback: F)
    where
        R: Read + Send + 'static,
        F: Fn(&str) + Send + 'static {
        thread::spawn(move || {
            let reader = BufReader::new(read);
            for line in reader.lines() {
                match line {
                    Ok(line) =>
                        line_callback(&line),
                    Err(err) =>
                        log::warn!("dropped output line due to read error: {}", err),
                }
            }
        });
    }

    // -- Generated by Claude Code --

    /// Polls for `lock.toml` to appear and parses the port from it.
    /// Returns the port string on success, or an error if the timeout expires.
    fn poll_lock_file(lock_file: &Path, timeout: Duration) -> anyhow::Result<String> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Ok(content) = fs::read_to_string(lock_file) {
                // Parse `port = <number>` from the TOML content.
                if let Some(port) = content
                    .lines()
                    .find_map(|line| line.strip_prefix("port = ")) {
                    break Ok(port.trim().to_string());
                }
            }

            if Instant::now() >= deadline {
                break Err(
                    anyhow::anyhow!(
                        "timed out waiting for lock file at {}", lock_file.display()));
            }

            thread::sleep(Duration::from_millis(100));
        }
    }
}
