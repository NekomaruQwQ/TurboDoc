use std::time::Duration;
use std::time::Instant;

/// Shared origin for cumulative startup timings across concurrent host
/// initialization paths.
///
/// Copies retain the same origin, so concurrent work can report comparable
/// timestamps without coordination or mutable shared state.
#[derive(Clone, Copy, Debug)]
pub struct StartupProbe {
    started_at: Instant,
}

impl StartupProbe {
    /// Start measuring immediately, before any initialization work begins.
    pub fn start() -> Self {
        Self {
            started_at: Instant::now(),
        }
    }

    /// Log a cumulative milestone relative to process initialization.
    pub fn mark(self, milestone: &str) {
        log::info!(
            "startup +{:>8.1} ms {milestone}",
            self.started_at.elapsed().as_secs_f64() * 1_000.0);
    }

    /// Log a cumulative milestone plus the duration of its just-finished
    /// phase. `phase_started_at` should be captured immediately before the
    /// measured operation.
    pub fn mark_phase(self, milestone: &str, phase_started_at: Instant) {
        self.mark_phase_duration(milestone, phase_started_at.elapsed());
    }

    /// Log a cumulative milestone plus an already measured phase duration.
    pub fn mark_phase_duration(self, milestone: &str, phase_duration: Duration) {
        log::info!(
            "startup +{:>8.1} ms {milestone} (phase {:.1} ms)",
            self.started_at.elapsed().as_secs_f64() * 1_000.0,
            phase_duration.as_secs_f64() * 1_000.0);
    }
}

/// Opaque startup surfaces use the frontend workbench color so the visible
/// native window and WebView2 controller never flash white before first paint.
#[derive(Clone, Copy, Debug)]
pub struct StartupColor {
    pub red: u8,
    pub green: u8,
    pub blue: u8,
}

/// Exact sRGB conversion of the frontend's
/// `--workbench: oklch(0.17 0.008 264)` theme token.
pub const STARTUP_BACKGROUND: StartupColor = StartupColor {
    red: 14,
    green: 15,
    blue: 19,
};
