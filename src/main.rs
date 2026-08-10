//! TurboDoc — starts Vite and hosts the WebView2 window.
//!
//! Lifecycle:
//! 1. Build a multi-thread tokio runtime (backend handlers run on worker
//!    threads via `Server::fetch`/`Server::dispatch_api`, so the main thread
//!    is free for eframe/WebView2).
//! 2. Start the in-process backend and open the SQLite cache.
//! 3. Spawn Vite on the runtime while eframe creates the root winit window
//!    and renders a native egui startup surface through wgpu.
//! 4. Create WebView2 asynchronously as a hidden child of that window.
//!    Navigate to `127.0.0.1:{port}` only after both WebView2 and Vite are
//!    ready. The first top-level completion reveals the Svelte workbench and
//!    releases its initially blank documentation iframe on the next browser
//!    animation frame.
//! 5. Drop the runtime, which cancels in-flight tokio tasks. The Vite
//!    child dies via the Job Object on host exit.

mod prelude {
    pub type WebRequestBuilder = http::request::Builder;
    pub type WebRequest = http::Request<Vec<u8>>;
    pub type WebResponse = http::Response<Vec<u8>>;
}

mod app;
mod server;
mod startup;
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
    "https://docs.rs/",
    "https://doc.rust-lang.org/",
    "https://microsoft.github.io/windows-docs-rs/doc/",
    "https://index.crates.io/",
    "https://crates.io/api/v1/crates/",
];

fn main() {
    let startup = startup::StartupProbe::start();
    pretty_env_logger::init();
    startup.mark("logger initialized");
    main::main(startup);
}

mod main {
    use std::env;
    use std::path::Path;
    use std::path::PathBuf;
    use std::time::Instant;

    use clap::Parser;

    use crate::startup::StartupProbe;

    /// TurboDoc — universal documentation viewer.
    #[derive(Parser)]
    #[command(version, about)]
    struct Args {
        /// Runtime data directory (caches, presets, per-provider data).
        /// Falls back to the `TURBODOC_DATA` environment variable.
        #[arg(short = 'd', long = "data", env = "TURBODOC_DATA")]
        data_dir: PathBuf,

        /// Local port that Vite binds to. Falls back to the
        /// `TURBODOC_PORT` environment variable.
        #[arg(short = 'p', long = "port", env = "TURBODOC_PORT")]
        port: u16,
    }

    pub fn main(startup: StartupProbe) {
        let args = Args::parse();
        startup.mark("CLI arguments parsed");
        let port = args.port;
        let data_dir = args.data_dir;

        let self_path =
            env::current_exe()
                .expect("failed to get executable path");
        log::info!("executable path: {}", self_path.display());
        let root_dir =
            get_root_dir_from_self_path(&self_path)
                .expect("unexpected executable path");
        log::info!("root_dir: {}", root_dir.display());
        log::info!("data_dir: {}", data_dir.display());

        // Job Object: any process the host spawns (Vite, when --dev is on)
        // inherits this job and gets killed-on-close. Without it, killing
        // the host via Task Manager could leave orphaned Vite processes.
        let job_object = create_job_object();
        startup.mark("process Job Object configured");

        // -- Build runtime and start server --
        let runtime_started_at = Instant::now();
        let runtime =
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("failed to build tokio runtime");
        startup.mark_phase("tokio runtime ready", runtime_started_at);

        let server =
            runtime
                .block_on(crate::server::start(crate::server::Config {
                    data_dir,
                }, startup))
                .expect("failed to start server");

        // -- Spawn Vite and app concurrently --
        startup.mark("starting frontend and native app");
        crate::app::run(
            format!("http://127.0.0.1:{port}"),
            server,
            crate::server::FrontendConfig {
                port,
                root_dir,
            },
            startup);

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
