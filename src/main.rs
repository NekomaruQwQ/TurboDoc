//! TurboDoc — hosts the in-process axum server and the WebView2 window.
//!
//! Lifecycle:
//! 1. Build a multi-thread tokio runtime (server runs on worker threads so the
//!    main thread is free for winit/WebView2).
//! 2. Bind the server (await `server::start`); this returns once the listener
//!    is accepting, so no TCP-readiness polling is needed.
//! 3. Launch WebView2 on the main thread. It blocks until the user closes the
//!    window.
//! 4. Drop the runtime, which cancels the server task and any spawned Vite
//!    dev-server (the Job Object handles OS-level cleanup as a backstop).

mod prelude {
    pub type WebRequestBuilder = http::request::Builder;
    pub type WebRequest = http::Request<Vec<u8>>;
    pub type WebResponse = http::Response<Vec<u8>>;
}

mod app;
mod server;
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

    use clap::Parser;

    /// TurboDoc — universal documentation viewer.
    #[derive(Parser)]
    #[command(version, about)]
    struct Args {
        /// Runtime data directory (caches, presets, per-provider data).
        /// Falls back to the `TURBODOC_DATA` environment variable.
        #[arg(short = 'd', long = "data", env = "TURBODOC_DATA")]
        data_dir: PathBuf,

        /// Local port the server binds to.
        /// Falls back to the `TURBODOC_PORT` environment variable.
        #[arg(short = 'p', long = "port", env = "TURBODOC_PORT")]
        port: u16,

        /// Enable dev mode: spawn `vite dev` as a child process and
        /// reverse-proxy frontend assets to it (HMR preserved). Without this,
        /// the server expects `frontend/dist/` to exist and serves it
        /// statically.
        #[arg(long = "dev", default_value_t = false)]
        dev: bool,
    }

    pub fn main() {
        let args = Args::parse();
        let port = args.port;
        let data_dir = args.data_dir;
        let dev = args.dev;

        let self_path =
            env::current_exe()
                .expect("failed to get executable path");
        log::info!("executable path: {}", self_path.display());
        let root_dir =
            get_root_dir_from_self_path(&self_path)
                .expect("unexpected executable path");
        log::info!("root_dir: {}", root_dir.display());
        log::info!("data_dir: {}", data_dir.display());
        log::info!("dev mode: {dev}");

        // Job Object: any process the host spawns (Vite, when --dev is on)
        // inherits this job and gets killed-on-close. Without it, killing
        // the host via Task Manager could leave orphaned Vite processes.
        let job_object = create_job_object();

        // -- Build runtime and start server --
        let runtime =
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("failed to build tokio runtime");
        log::info!("starting server...");
        runtime
            .block_on(crate::server::start(crate::server::Config {
                port,
                data_dir,
                root_dir: root_dir.clone(),
                dev,
            }))
            .expect("failed to start server");
        log::info!("server ready on port {port}.");

        // -- Spawn app --
        log::info!("starting app...");
        crate::app::run(&format!("http://localhost:{port}"));

        // -- Cleanup --
        drop(runtime);
        drop(job_object);
    }

    /// Creates a Job Object and assigns the current process. Children
    /// (the Vite dev server in `--dev` mode) inherit the job, so they die
    /// with the host even on abrupt termination.
    fn create_job_object() -> win32job::Job {
        use tap::Pipe as _;
        use win32job::ExtendedLimitInfo;
        use win32job::Job;

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

    /// Walks up from the executable path to find the repo root.
    /// Used to locate `frontend/dist/` (prod mode) and `frontend/`
    /// (dev mode, for spawning Vite).
    fn get_root_dir_from_self_path(self_path: &Path) -> Option<PathBuf> {
        use tap::Pipe as _;

        // Expected path: `<repo>/target/debug/turbodoc.exe` — walk up 3.
        self_path
            .parent()?
            .parent()?
            .parent()?
            .to_path_buf()
            .pipe(Some)
    }
}
