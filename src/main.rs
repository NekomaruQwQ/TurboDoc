//! TurboDoc — hosts a release frontend or starts Vite for development.
//!
//! Lifecycle:
//! 1. Build a multi-thread tokio runtime (backend handlers run on worker
//!    threads via `Server::fetch`/`Server::dispatch_api`, so the main thread
//!    is free for winit, egui, and WebView2).
//! 2. Start the in-process backend and open the SQLite cache.
//! 3. In release mode, map the built frontend beside the executable. In dev
//!    mode, spawn Vite while winit creates the compact egui splash.
//! 4. Create WebView2 asynchronously as a hidden child of an independent,
//!    initially hidden Mica workbench window.
//!    Navigate only after its selected frontend source is ready. The first
//!    top-level completion releases the initially blank documentation iframe,
//!    reveals the workbench, and hides the splash.
//! 5. Drop the runtime, which cancels in-flight tokio tasks. A dev-mode Vite
//!    child also dies via its Job Object on host exit.

mod prelude {
    pub type WebRequestBuilder = http::request::Builder;
    pub type WebRequest = http::Request<Vec<u8>>;
    pub type WebResponse = http::Response<Vec<u8>>;
}

mod app;
mod dev;
mod server;
mod startup;
mod webview;

fn main() {
    let startup = startup::StartupProbe::start();
    pretty_env_logger::init();
    startup.mark("logger initialized");
    main::main(startup);
}

mod main {
    use std::env;
    use std::path::PathBuf;
    use std::time::Instant;

    use clap::Parser;

    use crate::startup::StartupProbe;

    /// TurboDoc — universal documentation viewer.
    #[derive(Parser)]
    #[command(version, about)]
    struct Args {
        /// Runtime data directory (cache, UI state, and per-source data).
        /// Falls back to the `TURBODOC_DATA` environment variable.
        #[arg(short = 'd', long = "data", env = "TURBODOC_DATA")]
        data_dir: PathBuf,

        /// Local port that Vite binds to in dev mode. Falls back to the
        /// `TURBODOC_PORT` environment variable.
        #[arg(
            short = 'p',
            long = "port",
            env = "TURBODOC_PORT",
            required_if_eq("dev", "true"))]
        port: Option<u16>,

        /// Spawn the Vite development server instead of loading built assets.
        #[arg(long = "dev", default_value_t = false)]
        dev: bool,
    }

    pub fn main(startup: StartupProbe) {
        let args = Args::parse();
        startup.mark("CLI arguments parsed");
        let data_dir = args.data_dir;

        let self_path =
            env::current_exe()
                .expect("failed to get executable path");
        log::info!("executable path: {}", self_path.display());
        log::info!("data_dir: {}", data_dir.display());
        log::info!("frontend mode: {}", if args.dev { "dev" } else { "release" });

        // -- Build runtime and select frontend --
        let runtime_started_at = Instant::now();
        let runtime =
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("failed to build tokio runtime");
        startup.mark_phase("tokio runtime ready", runtime_started_at);

        let frontend = if args.dev {
            let port = args.port
                .expect("clap requires --port or TURBODOC_PORT with --dev");
            crate::app::FrontendSource::dev(
                crate::dev::Frontend::new(
                    runtime.handle().clone(),
                    &self_path,
                    port)
                    .expect("failed to configure development frontend"))
        } else {
            crate::app::FrontendSource::release(&self_path)
                .expect("failed to locate release frontend")
        };

        // -- Start backend --
        let server =
            runtime
                .block_on(crate::server::start(crate::server::Config {
                    data_dir,
                }, startup))
                .expect("failed to start server");

        // -- Start frontend and native app --
        startup.mark("starting selected frontend and native app");
        crate::app::run(
            frontend,
            server,
            startup);

        // -- Cleanup --
        drop(runtime);
    }

    #[cfg(test)]
    mod tests {
        use clap::CommandFactory as _;
        use clap::error::ErrorKind;

        use super::Args;

        /// Build the CLI without ambient port configuration so conditional
        /// requirements remain deterministic under developer environments.
        fn command_without_port_environment() -> clap::Command {
            Args::command()
                .mut_arg("port", |arg| arg.env(None::<&str>))
        }

        #[test]
        fn release_mode_does_not_require_a_port() {
            let result = command_without_port_environment()
                .try_get_matches_from(["turbodoc", "--data", "data"]);

            assert!(result.is_ok(), "release CLI failed: {result:?}");
        }

        #[test]
        fn dev_mode_requires_a_port() {
            let error = command_without_port_environment()
                .try_get_matches_from([
                    "turbodoc",
                    "--data",
                    "data",
                    "--dev"])
                .expect_err("dev CLI should reject a missing port");

            assert_eq!(error.kind(), ErrorKind::MissingRequiredArgument);
        }
    }
}
