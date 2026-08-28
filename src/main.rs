//! TurboDoc — hosts a release frontend or starts Vite for development.
//!
//! Lifecycle:
//! 1. Build a multi-thread tokio runtime (backend handlers run on worker
//!    threads via `Server::fetch`/`Server::dispatch_api`, so the main thread
//!    is free for eframe/WebView2).
//! 2. Start the in-process backend and open the SQLite cache.
//! 3. In release mode, map the built frontend beside the executable. In dev
//!    mode, spawn Vite while eframe creates the native window.
//! 4. Create WebView2 asynchronously as a hidden child of that window.
//!    Navigate only after its selected frontend source is ready. The first
//!    top-level completion reveals the Svelte workbench and releases its
//!    initially blank documentation iframe on the next animation frame.
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

/// URL prefixes that the host can navigate to instead of opening in
/// external browser.
const HOSTED_URL: &[&str] = &[
    "https://docs.rs/",
    "https://doc.rust-lang.org/",
    "https://rust-analyzer.github.io/book/",
    "https://rustc-dev-guide.rust-lang.org/",
    "https://rust-lang.github.io/rustup/",
    "https://microsoft.github.io/windows-docs-rs/doc/",
    "https://en.wikipedia.org/",
    "https://minecraft.wiki/",
    "https://zh.minecraft.wiki/",
];

/// URL prefixes that the host intercepts and proxies to the server,
/// instead of letting WebView2 handle them directly.
const PROXIED_URL: &[&str] = &[
    "https://docs.rs/",
    "https://doc.rust-lang.org/",
    "https://rust-analyzer.github.io/book/",
    "https://rustc-dev-guide.rust-lang.org/",
    "https://rust-lang.github.io/rustup/",
    "https://microsoft.github.io/windows-docs-rs/doc/",
    "https://en.wikipedia.org/",
    "https://minecraft.wiki/",
    "https://zh.minecraft.wiki/",
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

        /// WebView2 content scale multiplier (1.0 = 100%, 1.1 = 110%).
        #[arg(
            short = 's',
            long = "scale-factor",
            default_value_t = 1.0,
            value_parser = parse_scale_factor)]
        scale_factor: f64,
    }

    /// Parse the content scale before startup so invalid values receive a CLI
    /// error instead of reaching WebView2. Reject malformed, nonfinite, and
    /// nonpositive numbers; WebView2 owns its supported positive zoom range.
    fn parse_scale_factor(value: &str) -> Result<f64, &'static str> {
        let scale_factor = value.parse::<f64>()
            .map_err(|_| "scale factor must be a number")?;
        if !scale_factor.is_finite() || scale_factor <= 0.0 {
            return Err("scale factor must be finite and greater than zero");
        }
        Ok(scale_factor)
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
            args.scale_factor,
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

        /// Release startup needs no port and defaults to 100% content scale.
        #[test]
        fn release_mode_uses_default_scale_without_a_port() {
            let matches = command_without_port_environment()
                .try_get_matches_from(["turbodoc", "--data", "data"])
                .expect("release CLI should not require a port or scale factor");

            assert_eq!(matches.get_one::<f64>("scale_factor"), Some(&1.0));
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

        /// Both spellings accept zooming out, zooming in, and scientific
        /// notation without duplicating WebView2's internal range limits.
        #[test]
        fn scale_factor_accepts_positive_finite_values_with_both_flags() {
            for flag in ["--scale-factor", "-s"] {
                for (value, expected) in [
                    ("0.9", 0.9),
                    ("1", 1.0),
                    ("1.1", 1.1),
                    ("1e1", 10.0),
                ] {
                    let matches = command_without_port_environment()
                        .try_get_matches_from([
                            "turbodoc", "--data", "data", flag, value])
                        .expect("positive finite scale factor should be accepted");

                    assert_eq!(
                        matches.get_one::<f64>("scale_factor"),
                        Some(&expected),
                        "unexpected value for {flag} {value}");
                }
            }
        }

        /// The same scale option is available when Vite supplies the frontend.
        #[test]
        fn dev_mode_accepts_a_scale_factor() {
            let matches = command_without_port_environment()
                .try_get_matches_from([
                    "turbodoc", "--data", "data", "--dev", "--port", "5173",
                    "-s", "1.1"])
                .expect("dev CLI should accept a scale factor with its port");

            assert_eq!(matches.get_one::<f64>("scale_factor"), Some(&1.1));
        }

        /// Invalid scales fail in argument parsing, before any runtime,
        /// backend data, or native window is initialized.
        #[test]
        fn scale_factor_rejects_invalid_values() {
            for value in ["", "abc", "0", "-0", "-1", "NaN", "inf", "-inf", "1e309"] {
                // `=` ensures negative values reach the value parser instead
                // of being interpreted as another CLI option by Clap.
                let argument = format!("--scale-factor={value}");
                let error = command_without_port_environment()
                    .try_get_matches_from(["turbodoc", "--data", "data", &argument])
                    .expect_err("invalid scale factor should be rejected");

                assert_eq!(
                    error.kind(),
                    ErrorKind::ValueValidation,
                    "unexpected error for {argument}: {error}");
            }
        }
    }
}
