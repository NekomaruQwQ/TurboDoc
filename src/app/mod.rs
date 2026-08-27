//! TurboDoc's native application shell.
//!
//! The public surface selects a frontend and runs the host. Internal modules
//! separate pure lifecycle and routing policy from winit, egui, and WebView2
//! adapters.

mod frontend;
mod host;
mod lifecycle;
mod routing;
mod splash;
mod webview_handlers;

use std::time::Instant;

pub use self::frontend::FrontendSource;
pub use self::host::run;

/// Cross-thread and platform-adapter messages that wake the native host.
#[derive(Debug)]
enum HostEvent {
    /// One callback slot or lifecycle receiver may now contain new state.
    Wake,
    /// egui requested another splash frame at a specific monotonic time.
    RequestRepaint {
        /// Earliest time at which the frame should be requested.
        when: Instant,
        /// Pass number at the call site, retained to discard stale requests.
        cumulative_pass_nr: u64,
    },
    /// Native accessibility input routed back into the splash integration.
    AccessKit(egui_winit::accesskit_winit::Event),
}

impl From<egui_winit::accesskit_winit::Event> for HostEvent {
    fn from(event: egui_winit::accesskit_winit::Event) -> Self {
        Self::AccessKit(event)
    }
}
