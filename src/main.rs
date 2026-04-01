#![feature(try_blocks)]
#![feature(exit_status_error)]

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
use std::io::*;
use std::path::Path;
use std::process;
use std::process::*;
use std::result::Result;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use tap::prelude::*;

use anyhow::Context as _;

fn main() -> anyhow::Result<()> {
    pretty_env_logger::init();

    let job_object = create_job_object()?;

    let self_path =
        env::current_exe()
            .context("std::env::current_exe() failed")
            .context("failed to get executable path")?;
    log::info!("executable path: {}", self_path.display());

    // The executable path is expected to be `<repo>/target/debug/turbodoc.exe`.
    // So we walk up three levels to find the repo root.
    let root_dir =
        self_path
            .pipe_as_ref(Path::parent)
            .and_then(Path::parent)
            .and_then(Path::parent)
            .map(Path::to_path_buf)
            .ok_or_else(|| anyhow::anyhow!("unexpected executable path"))?;
    let data_dir =
        root_dir.join("target/data");
    let app_exe =
        root_dir.join("app/bin/TurboDoc/debug_win-x64/TurboDoc.exe");
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

    // -- Conditional rebuild the WinUI app --
    log::info!("checking if the WinUI app needs rebuild...");
    // .NET 5+ emits both the .exe and a .dll, but the .dll is the one that
    // actually gets updated on rebuilds and the .exe is just a thin host
    // that doesn't get touched if the source changes.
    // So here we check the .dll's timestamp to decide if a rebuild is needed.
    if is_app_rebuild_needed(
        &root_dir,
        &app_exe.with_extension("dll")).unwrap_or(true) {
        match build_app(&root_dir) {
            Ok(()) =>
                log::info!("app built successfully."),
            Err(err) =>
                log::error!("failed to build app: {err}"),
        }
    }

    // -- Spawn server --
    // The server binds to $TURBODOC_PORT and writes `lock.toml` to the data dir
    // once ready. We poll for that file to confirm readiness.
    log::info!("starting server...");
    let server =
        spawn_server(&root_dir, &data_dir)?;
    let port =
        poll_lock_file(&lock_file, Duration::from_secs(10))
            .context("server is not ready within 10 seconds timeout")?;
    log::info!("server ready on port {port}.");

    // -- Spawn app --
    log::info!("starting WinUI app...");
    let app = spawn_app(&app_exe, &port)?;
    log::info!("WinUI app started.");

    // -- Race for termination --
    // Whichever child exits first causes the launcher to exit. The Job Object
    // then kills the remaining child.
    log::info!("waiting for server or app to exit...");
    wait_for_exit(server, app)?;

    // -- Cleanup --
    drop(job_object);
    Ok(())
}

/// Creates a Job Object and assigns the current process to it.
///
/// This ensures that if the launcher process exits for any reason (including
/// crashes), the OS will automatically terminate all child processes in the
/// job, preventing orphaned server/app processes.
fn create_job_object() -> anyhow::Result<win32job::Job> {
    use win32job::{
        Job,
        ExtendedLimitInfo,
    };

    let job_object =
        ExtendedLimitInfo::new()
            .limit_kill_on_job_close()
            .pipe(|&mut ref info| Job::create_with_limit_info(info))
            .context("failed to create job object")?;
    job_object
        .assign_current_process()
        .context("failed to assign current process to job object")?;
    job_object
        .pipe(Ok)
}

/// Returns `true` if any app source file is newer than the compiled binary,
/// or if the binary doesn't exist.
fn is_app_rebuild_needed(repo_root: &Path, target: &Path) -> Result<bool, ()> {
    let app_exe_modified_time =
        fs::metadata(target)
            .map_err(|_| ())?
            .modified()
            .map_err(|_| ())?;
    let sources =
        fs::read_dir(repo_root.join("app/src/"))
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

fn build_app(root_dir: &Path) -> anyhow::Result<()> {
    let status =
        Command::new("dotnet")
            .args(["build"])
            .current_dir(root_dir)
            .status()
            .context("`dotnet build` failed")?;
    if !status.success() {
        anyhow::bail!("`dotnet build` exited with status {status}");
    }

    Ok(())
}

fn spawn_server(root_dir: &Path, data_dir: &Path) -> anyhow::Result<Child> {
    let mut child =
        Command::new("bun")
            .args(["--hot", "server"])
            .current_dir(root_dir)
            .env("TURBODOC_DATA", data_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn server process")?;
    forward_output(&mut child, "@server")?;
    Ok(child)
}

fn spawn_app(path: &Path, port: &str) -> anyhow::Result<Child> {
    let mut child =
        Command::new(path)
            .env("TURBODOC_PORT", port)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to start WinUI app")?;
    forward_output(&mut child, "@app")?;
    Ok(child)
}

fn forward_output(child: &mut Child, tag: &'static str) -> anyhow::Result<()> {
    let stdout =
        child.stdout.take().context("failed to capture stdout")?;
    let stderr =
        child.stderr.take().context("failed to capture stderr")?;
    on_output(stdout, move |line| eprintln!("{tag} stdout> {line}"));
    on_output(stderr, move |line| eprintln!("{tag} stderr> {line}"));
    Ok(())
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

fn wait_for_exit(mut server: Child, mut app: Child) -> anyhow::Result<()> {
    let (tx, rx) = mpsc::channel::<anyhow::Result<()>>();

    let tx_server = tx.clone();
    let tx_app = tx;

    thread::spawn(move || tx_server.send(try {
        server
            .wait()
            .context("failed to wait on server process")?
            .exit_ok()
            .context("server process exited with error")?;
    }));

    thread::spawn(move || tx_app.send(try {
        app
            .wait()
            .context("failed to wait on WinUI app process")?
            .exit_ok()
            .context("WinUI app process exited with error")?;
    }));

    match rx.recv() {
        Ok(Ok(())) =>
            log::info!("child process exited successfully"),
        Ok(Err(err)) =>
            log::info!("child process exited with error: {}", err),
        Err(_) =>
            log::info!("unexpected child process exit"),
    }

    Ok(())
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
