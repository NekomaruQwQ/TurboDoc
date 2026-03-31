//! TurboDoc Launcher — spawns both the Bun server and the WinUI app as child
//! processes, forwarding their output and ensuring they are cleaned up together.
//!
//! Responsibilities:
//! 1. Single-instance guard: refuse to start if `lock.toml` exists in the data dir.
//! 2. Conditional rebuild: skip `dotnet build` if no source file changed.
//! 3. Job Object: kernel-level guarantee that children die with the launcher.
//! 4. Lock file polling: wait for the server to write `lock.toml` with its port.
//! 5. Console forwarding: prefix each child's output with `@server` / `@app`.
//! 6. Race-for-termination: when either child exits, the launcher exits too
//!    (and the Job Object kills the remaining child).
//! 7. Cleanup: delete `lock.toml` on exit.

use std::env;
use std::fs;
use std::io;
use std::io::*;
use std::path::{Path, PathBuf};
use std::process::*;
use std::result::Result;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use tap::prelude::*;

fn main() {
    pretty_env_logger::init();

    let job_object = create_job_object();

    let root_dir = get_repo_root();
    let data_dir = root_dir.join("target/data");
    let lock_file = data_dir.join("lock.toml");
    log::info!("root_dir: {}", root_dir.display());
    log::info!("data_dir: {}", data_dir.display());
    log::info!("lock_file: {}", lock_file.display());

    // -- Single-instance guard --
    if lock_file.exists() {
        eprintln!(
            "Error: lock file already exists at {}.\n\
             Another TurboDoc instance may be running. \
             If not, delete the file manually and try again.",
            lock_file.display());
        std::process::exit(1);
    }

    // -- Conditional rebuild --
    let app_exe = root_dir.join("out/bin/TurboDoc/debug_win-x64/TurboDoc.exe");
    if needs_rebuild(&root_dir, &app_exe) {
        build_app(&root_dir);
    }

    // -- Spawn server --
    // The server binds to $TURBODOC_PORT and writes `lock.toml` to the data dir
    // once ready. We poll for that file to confirm readiness.
    let mut server = spawn_server(&root_dir, &data_dir);
    let server_stderr = server.stderr.take().expect("failed to capture server stderr");
    let server_stdout = server.stdout.take().expect("failed to capture server stdout");
    forward_output(server_stderr, |line| eprintln!("@server stderr > {}", line));
    forward_output(server_stdout, |line| eprintln!("@server stdout > {}", line));

    let port = poll_lock_file(&lock_file, Duration::from_secs(10))
        .expect("server failed to become ready within 10 seconds");
    log::info!("server ready on port {port}.");

    // -- Spawn app --
    let mut app =
        Command::new(&app_exe)
            .env("TURBODOC_PORT", &port)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to start WinUI app");

    let app_stdout = app.stdout.take().expect("failed to capture app stdout");
    let app_stderr = app.stderr.take().expect("failed to capture app stderr");
    forward_output(app_stdout, |line| eprintln!("@app stdout > {}", line));
    forward_output(app_stderr, |line| eprintln!("@app stderr > {}", line));

    // -- Race for termination --
    // Whichever child exits first causes the launcher to exit. The Job Object
    // then kills the remaining child.
    let (tx, rx) = mpsc::channel::<(&str, io::Result<ExitStatus>)>();

    let tx_server = tx.clone();
    let tx_app = tx;
    thread::spawn(move || {
        let _ = tx_server.send(("server", server.wait()));
    });
    thread::spawn(move || {
        let _ = tx_app.send(("app", app.wait()));
    });

    match rx.recv() {
        Ok((name, status)) => {
            log::info!("{name} process exited with status: {status:?}");
        },
        _ => {
            log::info!("unexpected child process exit");
        }
    }

    // -- Cleanup --
    let _ = fs::remove_file(&lock_file);
    drop(job_object);
}

// == Infrastructure ==

/// Creates a Job Object and assigns the current process to it.
///
/// This ensures that if the launcher process exits for any reason (including
/// crashes), the OS will automatically terminate all child processes in the
/// job, preventing orphaned server/app processes.
fn create_job_object() -> win32job::Job {
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

/// Walks up from the executable to find the repo root.
/// Exe is at `<repo>/target/debug/turbodoc.exe` — 3 parents up.
fn get_repo_root() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|executable_path| Some({
            executable_path
                .parent()?
                .parent()?
                .parent()?
                .to_owned()
        }))
        .expect("failed to get repository root")
}

// == Child Processes ==

fn build_app(root_dir: &Path) {
    Command::new("dotnet")
        .args(["build", "app/TurboDoc.csproj", "-c", "Debug"])
        .current_dir(root_dir)
        .status()
        .expect("failed to build the WinUI app")
        .success()
        .then_some(())
        .expect("failed to build the WinUI app");
}

fn spawn_server(root_dir: &Path, data_dir: &Path) -> Child {
    Command::new("bun")
        .args(["--hot", "server"])
        .current_dir(root_dir)
        .env("TURBODOC_DATA", data_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to start server")
}

fn forward_output<R, F>(read: R, line_callback: F)
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

// == Lock File ==

/// Polls for `lock.toml` to appear and parses the port from it.
/// Returns the port string on success, or an error if the timeout expires.
fn poll_lock_file(lock_file: &Path, timeout: Duration) -> anyhow::Result<String> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Ok(content) = fs::read_to_string(lock_file) {
            // Parse `port = <number>` from the TOML content.
            if let Some(port) = content
                .lines()
                .find_map(|line| line.strip_prefix("port = "))
            {
                return Ok(port.trim().to_string());
            }
        }

        if Instant::now() >= deadline {
            return Err(anyhow::anyhow!(
                "timed out waiting for lock file at {}",
                lock_file.display()));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

// == Helpers ==

/// Returns `true` if any app source file is newer than the compiled binary,
/// or if the binary doesn't exist.
fn needs_rebuild(repo_root: &Path, app_exe: &Path) -> bool {
    needs_rebuild_internal(repo_root, app_exe)
        .unwrap_or(true)
}

fn needs_rebuild_internal(repo_root: &Path, app_exe: &Path) -> Result<bool, ()> {
    let app_exe_modified_time =
        fs::metadata(app_exe)
            .map_err(|_| ())?
            .modified()
            .map_err(|_| ())?;
    let sources =
        fs::read_dir(repo_root.join("app"))
            .map_err(|_| ())?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path());

    for path in sources {
        if  let Ok(meta) = fs::metadata(&path) &&
            let Ok(modified_time) = meta.modified() &&
            modified_time > app_exe_modified_time {
            return Ok(true);
        }
    }

    Ok(false)
}
