//! Native startup and failure presentation backed by egui and wgpu.

use std::num::NonZeroU32;
use std::sync::Arc;
use std::time::Instant;

use anyhow::Context as _;
use winit::dpi::LogicalSize;
use winit::dpi::PhysicalPosition;
use winit::dpi::PhysicalSize;
use winit::event::WindowEvent;
use winit::event_loop::ActiveEventLoop;
use winit::event_loop::EventLoopProxy;
use winit::window::Theme;
use winit::window::Window;
use winit::window::WindowAttributes;
use winit::window::WindowButtons;

use super::HostEvent;
use super::lifecycle::StartupStatus;

/// Compact logical client size reserved for the native startup and failure UI.
const SPLASH_SIZE: LogicalSize<f64> = LogicalSize::new(560.0, 320.0);

/// User-facing startup failure retained for egui rendering.
#[derive(Debug)]
pub(super) struct StartupFailure {
    /// Concise user-facing description of the failed startup phase.
    summary: &'static str,
    /// Complete error chain exposed by the expandable diagnostics surface.
    details: String,
}

impl StartupFailure {
    /// Capture one startup failure for rendering and clipboard export.
    pub(super) fn new(summary: &'static str, details: String) -> Self {
        Self { summary, details }
    }
}

/// One delayed egui repaint request retained until its monotonic deadline.
#[derive(Clone, Copy, Debug)]
struct ScheduledRepaint {
    /// Earliest time at which winit should request a redraw.
    when: Instant,
    /// egui pass number that originated this request.
    cumulative_pass_nr: u64,
}

/// Opaque winit/egui/wgpu surface used only while startup needs native UI.
pub(super) struct SplashSurface {
    /// Compact top-level splash window shared with the host event dispatcher.
    pub(super) window: Arc<Window>,
    /// Immediate-mode UI context shared by input and painting integrations.
    context: egui::Context,
    /// Converts splash window input and platform output for egui.
    state: egui_winit::State,
    /// Owns the splash's only wgpu surface and renderer.
    painter: egui_wgpu::winit::Painter,
    /// Nearest delayed repaint not yet turned into `RedrawRequested`.
    scheduled_repaint: Option<ScheduledRepaint>,
    /// Tracked visibility avoids rendering a hidden splash on Windows.
    visible: bool,
}

impl SplashSurface {
    /// Create and center the fixed native splash, then initialize its renderer.
    ///
    /// # Errors
    ///
    /// Returns an error when winit cannot create the window or wgpu cannot
    /// create a DX12-compatible surface for it.
    pub(super) fn new(
        event_loop: &ActiveEventLoop,
        event_loop_proxy: EventLoopProxy<HostEvent>)
     -> anyhow::Result<Self> {
        let window_started_at = Instant::now();
        let window = Arc::new(event_loop.create_window(
            WindowAttributes::default()
                .with_title("TurboDoc")
                .with_inner_size(SPLASH_SIZE)
                .with_enabled_buttons(WindowButtons::CLOSE)
                .with_resizable(false)
                .with_visible(false)
                .with_theme(Some(Theme::Dark)))
                .context("failed to create native splash window")?);
        center_window(event_loop, &window);

        let context = egui::Context::default();
        let mut visuals = egui::Visuals::dark();
        visuals.panel_fill = startup_background();
        visuals.window_fill = startup_background();
        visuals.extreme_bg_color = egui::Color32::from_rgb(22, 24, 30);
        context.set_visuals(visuals);

        let repaint_proxy = event_loop_proxy.clone();
        context.set_request_repaint_callback(move |info| {
            let event = HostEvent::RequestRepaint {
                when: Instant::now() + info.delay,
                cumulative_pass_nr: info.current_cumulative_pass_nr,
            };
            repaint_proxy.send_event(event).ok();
        });

        let mut painter = pollster::block_on(egui_wgpu::winit::Painter::new(
            context.clone(),
            egui_wgpu::WgpuConfiguration::default(),
            false,
            egui_wgpu::RendererOptions::default()));
        pollster::block_on(painter.set_window(
            egui::ViewportId::ROOT,
            Some(Arc::clone(&window))))
            .context("failed to create the splash wgpu surface")?;

        let mut state = egui_winit::State::new(
            context.clone(),
            egui::ViewportId::ROOT,
            event_loop,
            Some(window.scale_factor() as f32),
            Some(Theme::Dark),
            painter.max_texture_side());
        state.init_accesskit(event_loop, &window, event_loop_proxy);
        // AccessKit requires adapter installation before the first visible
        // frame; showing earlier panics inside its Windows initialization.
        window.set_visible(true);
        window.focus_window();
        log::debug!(
            "native splash and wgpu initialized in {:?}",
            window_started_at.elapsed());
        window.request_redraw();

        Ok(Self {
            window,
            context,
            state,
            painter,
            scheduled_repaint: None,
            visible: true,
        })
    }

    /// Feed one splash window event into egui and service render requests.
    pub(super) fn handle_window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        event: WindowEvent,
        status: StartupStatus,
        failure: Option<&StartupFailure>) {
        let response = self.state.on_window_event(&self.window, &event);
        if response.repaint && self.visible {
            self.window.request_redraw();
        }

        match event {
            WindowEvent::CloseRequested => {
                log::debug!("splash close requested during {status:?}");
                event_loop.exit();
            },
            WindowEvent::Resized(size) => self.resize(size),
            WindowEvent::RedrawRequested if self.visible =>
                self.paint(event_loop, status, failure),
            _ => {},
        }
    }

    /// Resize the wgpu surface while tolerating Windows' zero-sized minimize.
    fn resize(&mut self, size: PhysicalSize<u32>) {
        let Some(width) = NonZeroU32::new(size.width) else { return; };
        let Some(height) = NonZeroU32::new(size.height) else { return; };
        self.painter.on_window_resized(
            egui::ViewportId::ROOT,
            width,
            height);
    }

    /// Run one egui frame and present it to the opaque splash swapchain.
    fn paint(
        &mut self,
        event_loop: &ActiveEventLoop,
        status: StartupStatus,
        failure: Option<&StartupFailure>) {
        let raw_input = self.state.take_egui_input(&self.window);
        let mut exit_requested = false;
        let mut output = self.context.run_ui(raw_input, |ui| {
            exit_requested = render_splash(ui, status, failure);
        });
        self.state.handle_platform_output_with_event_loop(
            &self.window,
            event_loop,
            output.platform_output);
        let clipped_primitives = self.context.tessellate(
            output.shapes,
            output.pixels_per_point);
        self.painter.paint_and_update_textures(
            egui::ViewportId::ROOT,
            output.pixels_per_point,
            startup_clear_color(),
            &clipped_primitives,
            &mut output.textures_delta,
            Vec::new(),
            &self.window);
        if exit_requested {
            event_loop.exit();
        }
    }

    /// Route an AccessKit adapter event back into egui's splash state.
    pub(super) fn handle_accesskit_event(
        &mut self,
        event: egui_winit::accesskit_winit::Event) {
        use egui_winit::accesskit_winit::WindowEvent as AccessKitWindowEvent;

        if event.window_id != self.window.id() {
            return;
        }
        match event.window_event {
            AccessKitWindowEvent::InitialTreeRequested => {
                self.context.enable_accesskit();
                self.window.request_redraw();
            },
            AccessKitWindowEvent::ActionRequested(request) => {
                self.state.on_accesskit_action_request(request);
                self.window.request_redraw();
            },
            AccessKitWindowEvent::AccessibilityDeactivated =>
                self.context.disable_accesskit(),
        }
    }

    /// Retain a current egui repaint request, preferring the nearest deadline.
    pub(super) fn schedule_repaint(&mut self, when: Instant, cumulative_pass_nr: u64) {
        let repaint = ScheduledRepaint {
            when,
            cumulative_pass_nr,
        };
        let current_pass_nr = self.context.cumulative_pass_nr_for(egui::ViewportId::ROOT);
        if current_pass_nr != repaint.cumulative_pass_nr
            && current_pass_nr != repaint.cumulative_pass_nr + 1
        {
            return;
        }
        if repaint.when <= Instant::now() {
            if self.visible {
                self.window.request_redraw();
            }
            return;
        }
        if self.scheduled_repaint
            .is_none_or(|scheduled| repaint.when < scheduled.when)
        {
            self.scheduled_repaint = Some(repaint);
        }
    }

    /// Request a due repaint and discard requests superseded by newer frames.
    pub(super) fn flush_due_repaint(&mut self, now: Instant) {
        let Some(repaint) = self.scheduled_repaint
            .filter(|repaint| repaint.when <= now)
        else {
            return;
        };
        self.scheduled_repaint = None;
        let current_pass_nr = self.context.cumulative_pass_nr_for(egui::ViewportId::ROOT);
        let is_current = current_pass_nr == repaint.cumulative_pass_nr
            || current_pass_nr == repaint.cumulative_pass_nr + 1;
        if self.visible && is_current {
            self.window.request_redraw();
        }
    }

    /// Return the next relevant repaint deadline for winit's control flow.
    pub(super) fn repaint_deadline(&self) -> Option<Instant> {
        self.visible
            .then_some(self.scheduled_repaint)
            .flatten()
            .map(|repaint| repaint.when)
    }

    /// Change splash visibility and request its first restored frame.
    pub(super) fn set_visible(&mut self, visible: bool) {
        if self.visible == visible {
            return;
        }
        self.visible = visible;
        self.window.set_visible(visible);
        if visible {
            self.window.request_redraw();
        }
    }

    /// Release painter-owned renderer state before the event loop disappears.
    pub(super) fn destroy(&mut self) {
        self.painter.destroy();
    }
}

/// Center one newly created top-level window on the primary monitor.
pub(super) fn center_window(event_loop: &ActiveEventLoop, window: &Window) {
    let Some(monitor) = window.current_monitor().or_else(|| event_loop.primary_monitor()) else {
        return;
    };
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let window_size = window.outer_size();
    let x = i64::from(monitor_position.x)
        + (i64::from(monitor_size.width) - i64::from(window_size.width)) / 2;
    let y = i64::from(monitor_position.y)
        + (i64::from(monitor_size.height) - i64::from(window_size.height)) / 2;
    window.set_outer_position(PhysicalPosition::new(
        x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32));
}

/// Report failures that happen before egui's error surface can exist.
pub(super) fn show_native_startup_error(error: &impl std::fmt::Display) {
    use native_dialog::*;

    if let Err(dialog_error) = MessageDialogBuilder::default()
        .set_level(MessageLevel::Error)
        .set_title("TurboDoc couldn't start")
        .set_text(format!("The native window could not be initialized.\n\n{error:#}"))
        .alert()
        .show()
    {
        log::error!("failed to show native startup error: {dialog_error}");
    }
}

/// Render the startup or failure contents and report an Exit button click.
fn render_splash(
    ui: &mut egui::Ui,
    status: StartupStatus,
    failure: Option<&StartupFailure>)
 -> bool {
    let mut exit_requested = false;
    egui::CentralPanel::default()
        .frame(egui::Frame::NONE.fill(startup_background()))
        .show(ui, |ui| {
            if let Some(failure) = failure {
                exit_requested = render_failure(ui, failure);
            } else {
                render_startup(ui, status);
            }
        });
    exit_requested
}

/// Render centered startup progress inside the compact splash.
fn render_startup(ui: &mut egui::Ui, status: StartupStatus) {
    egui::Area::new(egui::Id::new("native_startup"))
        .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
        .movable(false)
        .interactable(false)
        .show(ui.ctx(), |ui| {
            ui.take_available_width();
            ui.vertical_centered(|ui| {
                ui.add(egui::Spinner::new().size(28.0));
                ui.add_space(14.0);
                let message = match status {
                    StartupStatus::Initializing => "Starting TurboDoc...",
                    StartupStatus::Navigating => "Loading Workspace...",
                    StartupStatus::Ready | StartupStatus::Failed => "",
                };
                ui.label(
                    egui::RichText::new(message)
                        .size(15.0)
                        .color(egui::Color32::from_rgb(190, 194, 204)));
            });
        });
}

/// Render a copyable startup error and return whether Exit was clicked.
fn render_failure(ui: &mut egui::Ui, failure: &StartupFailure) -> bool {
    let mut exit_requested = false;
    egui::Area::new(egui::Id::new("native_startup_failure"))
        .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
        .movable(false)
        .show(ui.ctx(), |ui| {
            ui.set_max_width(500.0);
            ui.vertical_centered(|ui| {
                ui.heading(egui::RichText::new("TurboDoc couldn't start").size(24.0));
                ui.add_space(10.0);
                ui.label(
                    egui::RichText::new(failure.summary)
                        .size(15.0)
                        .color(egui::Color32::from_rgb(205, 208, 216)));
                ui.add_space(14.0);
                egui::CollapsingHeader::new("Show details")
                    .show(ui, |ui| {
                        egui::ScrollArea::vertical()
                            .max_height(96.0)
                            .show(ui, |ui| {
                                ui.label(
                                    egui::RichText::new(&failure.details)
                                        .monospace()
                                        .color(egui::Color32::from_rgb(175, 179, 190)));
                            });
                    });
                ui.add_space(12.0);
                ui.horizontal(|ui| {
                    if ui.button("Copy details").clicked() {
                        ui.ctx().copy_text(failure.details.clone());
                    }
                    if ui.button("Exit").clicked() {
                        exit_requested = true;
                    }
                });
            });
        });
    exit_requested
}

/// Convert the shared startup token into egui's packed sRGB color.
fn startup_background() -> egui::Color32 {
    let color = crate::startup::STARTUP_BACKGROUND;
    egui::Color32::from_rgb(color.red, color.green, color.blue)
}

/// Convert the shared startup token into an opaque wgpu clear color.
fn startup_clear_color() -> [f32; 4] {
    let color = crate::startup::STARTUP_BACKGROUND;
    [
        f32::from(color.red) / 255.0,
        f32::from(color.green) / 255.0,
        f32::from(color.blue) / 255.0,
        1.0,
    ]
}
