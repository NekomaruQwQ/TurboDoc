//! Pure startup coordination and window-presentation policy.

use std::time::Duration;
use std::time::Instant;

use super::frontend::FrontendKind;

/// Upper bound for the first WebView2 navigation. WebView2 completion events
/// do not have an intrinsic deadline, so a missing callback must not leave the
/// native startup surface spinning forever.
pub(super) const INITIAL_NAVIGATION_TIMEOUT: Duration = Duration::from_secs(30);

/// High-level startup status rendered by the native egui surface.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum StartupStatus {
    /// Frontend and WebView2 readiness have not both arrived.
    Initializing,
    /// Initial top-level WebView2 navigation is in progress.
    Navigating,
    /// The frontend loaded and the workbench is visible.
    Ready,
    /// An unrecoverable startup failure is visible in the splash.
    Failed,
}

/// Synchronizes the selected frontend and WebView2 readiness paths.
///
/// This type intentionally has no platform dependencies so the readiness
/// ordering and one-shot navigation invariant can be covered by unit tests.
#[derive(Debug)]
pub(super) struct StartupCoordinator {
    /// Whether the selected frontend can accept the first navigation.
    pub(super) frontend_ready: bool,
    /// Whether WebView2 construction and handler installation completed.
    webview_ready: bool,
    /// Start of the bounded first-navigation wait, if claimed.
    pub(super) navigation_started_at: Option<Instant>,
    /// Current terminal or transitional startup state.
    pub(super) status: StartupStatus,
}

impl StartupCoordinator {
    /// Initialize release mode as locally ready while dev mode waits for Vite.
    pub(super) fn new(frontend_kind: FrontendKind) -> Self {
        Self {
            frontend_ready: frontend_kind == FrontendKind::Release,
            webview_ready: false,
            navigation_started_at: None,
            status: StartupStatus::Initializing,
        }
    }

    /// Record Vite readiness. Duplicate notifications are harmless because
    /// navigation is still guarded by `navigation_started_at`.
    pub(super) fn mark_frontend_ready(&mut self) {
        self.frontend_ready = true;
    }

    /// Record WebView2 controller readiness.
    pub(super) fn mark_webview_ready(&mut self) {
        self.webview_ready = true;
    }

    /// Claim the single initial-navigation request once both startup paths
    /// are ready. Failures permanently suppress navigation.
    pub(super) fn begin_navigation_if_ready(&mut self, now: Instant) -> bool {
        if self.status == StartupStatus::Initializing
            && self.frontend_ready
            && self.webview_ready
            && self.navigation_started_at.is_none()
        {
            self.navigation_started_at = Some(now);
            self.status = StartupStatus::Navigating;
            true
        } else {
            false
        }
    }

    /// Report a missing first-navigation completion event once its bounded
    /// wait has elapsed. A clock value before the recorded start is treated as
    /// not timed out, which keeps synthetic test clocks safe.
    pub(super) fn navigation_timed_out(&self, now: Instant, timeout: Duration) -> bool {
        self.status == StartupStatus::Navigating
            && self.navigation_started_at
                .and_then(|started_at| now.checked_duration_since(started_at))
                .is_some_and(|elapsed| elapsed >= timeout)
    }

    /// Complete startup after the initial navigation successfully paints.
    pub(super) fn mark_ready(&mut self) {
        debug_assert_eq!(self.status, StartupStatus::Navigating);
        self.status = StartupStatus::Ready;
    }

    /// Stop all further startup transitions after an unrecoverable error.
    pub(super) fn mark_failed(&mut self) {
        self.status = StartupStatus::Failed;
    }
}

/// Window visibility policy derived from native startup state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct WindowPresentation {
    /// Whether the native egui splash should be visible.
    pub(super) splash_visible: bool,
    /// Whether the Mica WebView2 workbench should be visible.
    pub(super) workbench_visible: bool,
}

/// Select the only visible top-level window for one startup state.
pub(super) fn window_presentation(status: StartupStatus) -> WindowPresentation {
    match status {
        StartupStatus::Ready => WindowPresentation {
            splash_visible: false,
            workbench_visible: true,
        },
        StartupStatus::Initializing | StartupStatus::Navigating | StartupStatus::Failed =>
            WindowPresentation {
                splash_visible: true,
                workbench_visible: false,
            },
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;
    use std::time::Instant;

    use super::StartupCoordinator;
    use super::StartupStatus;
    use super::window_presentation;
    use crate::app::frontend::FrontendKind;

    #[test]
    fn startup_waits_for_both_independent_readiness_paths() {
        let now = Instant::now();
        let mut frontend_first = StartupCoordinator::new(FrontendKind::Dev);
        frontend_first.mark_frontend_ready();
        assert!(!frontend_first.begin_navigation_if_ready(now));
        frontend_first.mark_webview_ready();
        assert!(frontend_first.begin_navigation_if_ready(now));
        assert!(!frontend_first.begin_navigation_if_ready(now));

        let mut webview_first = StartupCoordinator::new(FrontendKind::Dev);
        webview_first.mark_webview_ready();
        assert!(!webview_first.begin_navigation_if_ready(now));
        webview_first.mark_frontend_ready();
        assert!(webview_first.begin_navigation_if_ready(now));
        assert!(!webview_first.begin_navigation_if_ready(now));
    }

    #[test]
    fn startup_success_and_failure_are_terminal() {
        let now = Instant::now();
        let mut successful = StartupCoordinator::new(FrontendKind::Dev);
        successful.mark_frontend_ready();
        successful.mark_webview_ready();
        assert!(successful.begin_navigation_if_ready(now));
        successful.mark_ready();
        assert_eq!(successful.status, StartupStatus::Ready);
        assert!(!successful.begin_navigation_if_ready(now));

        let mut failed = StartupCoordinator::new(FrontendKind::Dev);
        failed.mark_frontend_ready();
        failed.mark_webview_ready();
        failed.mark_failed();
        assert_eq!(failed.status, StartupStatus::Failed);
        assert!(!failed.begin_navigation_if_ready(now));
    }

    #[test]
    fn ready_state_shows_only_the_mica_workbench() {
        assert_eq!(
            window_presentation(StartupStatus::Ready),
            super::WindowPresentation {
                splash_visible: false,
                workbench_visible: true,
            });
    }

    #[test]
    fn incomplete_or_failed_startup_shows_only_the_native_splash() {
        let expected = super::WindowPresentation {
            splash_visible: true,
            workbench_visible: false,
        };
        assert_eq!(
            [
                window_presentation(StartupStatus::Initializing),
                window_presentation(StartupStatus::Navigating),
                window_presentation(StartupStatus::Failed),
            ],
            [expected; 3]);
    }

    #[test]
    fn initial_navigation_timeout_is_bounded_at_the_deadline() {
        let started_at = Instant::now();
        let timeout = Duration::from_secs(30);
        let mut coordinator = StartupCoordinator::new(FrontendKind::Dev);
        coordinator.mark_frontend_ready();
        coordinator.mark_webview_ready();
        assert!(coordinator.begin_navigation_if_ready(started_at));

        assert!(!coordinator.navigation_timed_out(
            started_at + timeout - Duration::from_millis(1),
            timeout));
        assert!(coordinator.navigation_timed_out(started_at + timeout, timeout));
    }

    #[test]
    fn release_startup_waits_only_for_webview_readiness() {
        let now = Instant::now();
        let mut coordinator = StartupCoordinator::new(FrontendKind::Release);

        assert!(!coordinator.begin_navigation_if_ready(now));
        coordinator.mark_webview_ready();
        assert!(coordinator.begin_navigation_if_ready(now));
    }
}
