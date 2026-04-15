//! TurboDoc — spawns the Bun server and hosts the frontend in a WebView2 window,
//! forwarding server output and ensuring cleanup on exit.

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
    use std::path::PathBuf;
    use std::env;
    use std::io::prelude::*;
    use std::io::BufReader;
    use std::net::*;
    use std::process::*;
    use std::thread;
    use std::time::Duration;

    use tap::prelude::*;

    pub fn main() {
        let port =
            env::var("TURBODOC_PORT")
                .expect("TURBODOC_PORT is required to run TurboDoc")
                .parse::<u16>()
                .expect("TURBODOC_PORT must be a valid port number");
        let self_path =
            env::current_exe()
                .expect("failed to get executable path");
        log::info!("executable path: {}", self_path.display());
        let root_dir =
            get_root_dir_from_self_path(&self_path)
                .expect("unexpected executable path");
        let data_dir =
            root_dir.join("target/data");
        log::info!("root_dir: {}", root_dir.display());
        log::info!("data_dir: {}", data_dir.display());

        let job_object = create_job_object();

        // -- Spawn server --
        log::info!("starting server...");
        let server = spawn_server(&root_dir, &data_dir);
        SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)
            .pipe(SocketAddr::from)
            .pipe(|addr| TcpStream::connect_timeout(&addr, Duration::from_secs(10)))
            .expect("failed to connect to server within timeout");
        log::info!("server ready on port {port}.");

        // -- Spawn app --
        log::info!("starting app...");
        crate::app::run(&format!("http://localhost:{port}"));

        // -- Cleanup --
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
                .pipe(|info| Job::create_with_limit_info(info))
                .expect("failed to create job object");
        job_object
            .assign_current_process()
            .expect("failed to assign current process to job object");
        job_object
    }

    fn get_root_dir_from_self_path(self_path: &Path) -> Option<PathBuf> {
        // The executable path is expected to be `<repo>/target/debug/turbodoc.exe`.
        // So we walk up three levels to find the repo root.
        self_path
            .parent()?
            .parent()?
            .parent()?
            .to_path_buf()
            .pipe(Some)
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
}
