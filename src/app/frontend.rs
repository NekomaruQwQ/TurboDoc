//! Frontend source selection and release-asset configuration.

use std::path::Path;
use std::path::PathBuf;

use anyhow::Context as _;

use crate::dev;
use crate::webview::WebView;

/// Reserved virtual host used only for executable-adjacent release assets.
const RELEASE_FRONTEND_HOST: &str = "turbodoc.example";
/// Origin of the executable-adjacent release frontend.
pub(super) const RELEASE_FRONTEND_ORIGIN: &str = "https://turbodoc.example";
/// Unmapped release origin whose `/api/*` requests reach `WebResourceRequested`.
///
/// WebView2 does not raise that event for URLs claimed by a virtual-host folder
/// mapping, so release APIs cannot share [`RELEASE_FRONTEND_ORIGIN`].
pub(super) const RELEASE_API_ORIGIN: &str = "https://api.turbodoc.example";
/// Persistence metadata JavaScript must read across the release origin split.
pub(super) const RESOURCE_EXISTS_HEADER: &str = "x-turbodoc-resource-exists";
/// Explicit entry document because virtual-host mappings do not add directory
/// index behavior.
const RELEASE_FRONTEND_URL: &str = "https://turbodoc.example/index.html";

/// Runtime frontend behavior relevant to shared host startup and routing.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum FrontendKind {
    /// Load optimized static artifacts through WebView2 folder mapping.
    Release,
    /// Wait for a host-owned Vite child and preserve HMR.
    Dev,
}

/// Frontend source selected by the CLI before native startup begins.
pub enum FrontendSource {
    /// Executable-adjacent Vite build artifacts.
    Release {
        /// Directory mapped to the reserved release frontend host.
        public_dir: PathBuf,
    },
    /// Prepared Vite development frontend and child-process lifetime.
    Dev(dev::Frontend),
}

impl FrontendSource {
    /// Locate release artifacts beside `executable_path` in `public/`.
    ///
    /// Artifact existence is checked after the native startup surface exists,
    /// so missing package contents receive the normal in-window diagnostics.
    ///
    /// # Errors
    ///
    /// Returns an error when `executable_path` has no parent directory.
    pub fn release(executable_path: &Path) -> anyhow::Result<Self> {
        let executable_dir = executable_path
            .parent()
            .context("executable path has no parent directory")?;
        Ok(Self::Release {
            public_dir: executable_dir.join("public"),
        })
    }

    /// Wrap a prepared Vite development frontend.
    pub fn dev(frontend: dev::Frontend) -> Self { Self::Dev(frontend) }

    /// Return the selected behavior without exposing source-specific state.
    pub(super) fn kind(&self) -> FrontendKind {
        match self {
            Self::Release { .. } => FrontendKind::Release,
            Self::Dev(_) => FrontendKind::Dev,
        }
    }

    /// Return the origin used to scope intercepted application API requests.
    pub(super) fn api_origin(&self) -> &str {
        match self {
            Self::Release { .. } => RELEASE_API_ORIGIN,
            Self::Dev(frontend) => frontend.origin(),
        }
    }

    /// Return the initial top-level WebView2 destination.
    pub(super) fn url(&self) -> &str {
        match self {
            Self::Release { .. } => RELEASE_FRONTEND_URL,
            Self::Dev(frontend) => frontend.origin(),
        }
    }

    /// Borrow the release artifact directory when folder mapping is required.
    pub(super) fn release_public_dir(&self) -> Option<&Path> {
        match self {
            Self::Release { public_dir } => Some(public_dir),
            Self::Dev(_) => None,
        }
    }
}

/// Validate and map executable-adjacent release assets before navigation.
///
/// # Errors
///
/// Returns an error when `index.html` is unreadable or WebView2 rejects the
/// virtual-host mapping.
pub(super) fn configure_release_frontend(
    webview: &WebView,
    public_dir: &Path)
 -> anyhow::Result<()> {
    let index_path = public_dir.join("index.html");
    std::fs::File::open(&index_path)
        .with_context(|| format!(
            "release frontend entry is missing or unreadable: {}",
            index_path.display()))?;
    webview
        .set_virtual_host_name_to_folder_mapping(
            RELEASE_FRONTEND_HOST,
            public_dir)
        .with_context(|| format!(
            "failed to map release frontend directory {}",
            public_dir.display()))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::FrontendSource;

    #[test]
    fn release_assets_are_resolved_beside_the_executable() {
        let source = FrontendSource::release(Path::new(
            r"D:\repo\target\debug\turbodoc.exe"))
            .expect("executable should have a parent directory");
        let FrontendSource::Release { public_dir } = source else {
            panic!("release constructor returned dev mode");
        };

        assert_eq!(public_dir, Path::new(r"D:\repo\target\debug\public"));
    }
}
