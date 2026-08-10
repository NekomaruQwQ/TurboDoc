use nkcore::prelude::*;

use crate::server::FrontendConfig;
use crate::server::FrontendEvent;
use crate::server::Server;
use crate::startup::StartupProbe;
use crate::webview::WebView;

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::OnceLock;
use std::sync::mpsc;
use std::time::Duration;
use std::time::Instant;
use windows::Win32::Foundation::RECT;
use winit::dpi::PhysicalSize;
use winit::window::Window;

/// Upper bound for the first WebView2 navigation. WebView2 completion events
/// do not have an intrinsic deadline, so a missing callback must not leave the
/// native startup surface spinning forever.
const INITIAL_NAVIGATION_TIMEOUT: Duration = Duration::from_secs(30);

/// Build the exact WebView2 URL patterns whose requests TurboDoc handles.
///
/// Proxy bases end in `/`, so appending `*` cannot accidentally match a
/// longer hostname. The frontend API pattern is scoped to the configured
/// Vite origin instead of intercepting unrelated localhost traffic.
fn web_resource_request_filters(frontend_url: &str) -> Vec<String> {
    let proxy_filters =
        crate::PROXIED_URL
            .iter()
            .map(|base_url| format!("{base_url}*"));
    let frontend_api_filter =
        format!("{}/api/v1/*", frontend_url.trim_end_matches('/'));
    proxy_filters
        .chain(std::iter::once(frontend_api_filter))
        .collect()
}

/// Run the eframe host while Vite and WebView2 initialize concurrently.
///
/// eframe owns the root winit window and wgpu surface. WebView2 is created
/// asynchronously as a child of that same HWND, so egui can keep rendering
/// startup progress until both Vite and the controller are ready.
pub fn run(
    url: String,
    server: Server,
    frontend_config: FrontendConfig,
    startup: StartupProbe) {
    // Start Vite before eframe initializes wgpu so the two slower startup
    // paths overlap. The monitor requests a repaint for both readiness and a
    // later child exit; before eframe exists, its queued event is sufficient.
    let (frontend_tx, frontend_rx) = mpsc::channel();
    let frontend_repaint = Arc::new(OnceLock::<eframe::egui::Context>::new());
    let callback_repaint = Arc::clone(&frontend_repaint);
    server.spawn_frontend(frontend_config, startup, move |event| {
        if frontend_tx.send(event).is_err() {
            log::debug!("discarding Vite lifecycle event after eframe shutdown");
            return;
        }
        if let Some(context) = callback_repaint.get() {
            context.request_repaint();
        }
    });

    let native_options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_inner_size([1280.0, 800.0]),
        renderer: eframe::Renderer::Wgpu,
        persist_window: false,
        ..Default::default()
    };
    let eframe_started_at = Instant::now();
    let creation_repaint = Arc::clone(&frontend_repaint);
    if let Err(err) = eframe::run_native(
        "TurboDoc",
        native_options,
        Box::new(move |creation_context| {
            if creation_repaint
                .set(creation_context.egui_ctx.clone())
                .is_err()
            {
                log::error!("eframe repaint context initialized more than once");
            }
            startup.mark_phase(
                "eframe window and wgpu ready",
                eframe_started_at);
            Ok(Box::new(TurboDocApp::new(
                creation_context,
                url,
                server,
                frontend_rx,
                startup)?))
        }))
    {
        log::error!("native host failed: {err:#}");
        show_native_startup_error(&err);
    }
}

/// High-level startup status rendered by the native egui surface.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StartupStatus {
    Initializing,
    Navigating,
    Ready,
    Failed,
}

/// Synchronizes the independent Vite and WebView2 readiness paths.
///
/// This type intentionally has no platform dependencies so the readiness
/// ordering and one-shot navigation invariant can be covered by unit tests.
#[derive(Debug)]
struct StartupCoordinator {
    frontend_ready: bool,
    webview_ready: bool,
    navigation_started_at: Option<Instant>,
    status: StartupStatus,
}

impl Default for StartupCoordinator {
    fn default() -> Self {
        Self {
            frontend_ready: false,
            webview_ready: false,
            navigation_started_at: None,
            status: StartupStatus::Initializing,
        }
    }
}

impl StartupCoordinator {
    /// Record Vite readiness. Duplicate notifications are harmless because
    /// navigation is still guarded by `navigation_started_at`.
    fn mark_frontend_ready(&mut self) {
        self.frontend_ready = true;
    }

    /// Record WebView2 controller readiness.
    fn mark_webview_ready(&mut self) {
        self.webview_ready = true;
    }

    /// Claim the single initial-navigation request once both startup paths
    /// are ready. Failures permanently suppress navigation.
    fn begin_navigation_if_ready(&mut self, now: Instant) -> bool {
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
    fn navigation_timed_out(&self, now: Instant, timeout: Duration) -> bool {
        self.status == StartupStatus::Navigating
            && self.navigation_started_at
                .and_then(|started_at| now.checked_duration_since(started_at))
                .is_some_and(|elapsed| elapsed >= timeout)
    }

    /// Complete startup after the initial navigation successfully paints.
    fn mark_ready(&mut self) {
        debug_assert_eq!(self.status, StartupStatus::Navigating);
        self.status = StartupStatus::Ready;
    }

    /// Stop all further startup transitions after an unrecoverable error.
    fn mark_failed(&mut self) {
        self.status = StartupStatus::Failed;
    }
}

/// User-facing startup failure retained for egui rendering.
#[derive(Debug)]
struct StartupFailure {
    summary: &'static str,
    details: String,
}

/// Native application state shared by the splash UI and WebView2 host.
struct TurboDocApp {
    window: Arc<Window>,
    url: String,
    server: Option<Server>,
    frontend_rx: mpsc::Receiver<FrontendEvent>,
    webview_result: Rc<RefCell<Option<anyhow::Result<WebView>>>>,
    navigation_result: Rc<RefCell<Option<anyhow::Result<()>>>>,
    webview: Option<WebView>,
    webview_size: PhysicalSize<u32>,
    coordinator: StartupCoordinator,
    failure: Option<StartupFailure>,
    startup: StartupProbe,
}

impl TurboDocApp {
    /// Initialize egui styling and begin asynchronous WebView2 creation for
    /// eframe's root HWND. The callback requests a repaint so startup can
    /// advance even when no window input occurs.
    fn new(
        creation_context: &eframe::CreationContext<'_>,
        url: String,
        server: Server,
        frontend_rx: mpsc::Receiver<FrontendEvent>,
        startup: StartupProbe)
     -> anyhow::Result<Self> {
        use nkcore::prelude::RawWindowHandleExt as _;
        use winit::raw_window_handle::HasWindowHandle as _;
        use winit::window::Theme;

        let window = Arc::clone(
            creation_context
                .winit_window()
                .context("eframe did not expose its root winit window")?);
        window.set_theme(Some(Theme::Dark));
        let hwnd =
            window
                .window_handle()
                .context("failed to get eframe window handle")?
                .as_raw()
                .as_hwnd();

        let background = startup_background();
        let mut visuals = eframe::egui::Visuals::dark();
        visuals.panel_fill = background;
        visuals.window_fill = background;
        visuals.extreme_bg_color = eframe::egui::Color32::from_rgb(22, 24, 30);
        creation_context.egui_ctx.set_visuals(visuals);

        let webview_result = Rc::new(RefCell::new(None));
        let result_slot = Rc::clone(&webview_result);
        let repaint_context = creation_context.egui_ctx.clone();
        let webview_started_at = std::time::Instant::now();
        let begin_webview_result = WebView::begin_create(hwnd, startup, move |result| {
            if result_slot.replace(Some(result)).is_some() {
                log::error!("WebView2 creation completed more than once");
            }
            repaint_context.request_repaint();
        });

        startup.mark_phase(
            "WebView2 asynchronous creation requested",
            webview_started_at);
        startup.mark("native startup surface shown");

        let mut app = Self {
            webview_size: window.inner_size(),
            window,
            url,
            server: Some(server),
            frontend_rx,
            webview_result,
            navigation_result: Rc::new(RefCell::new(None)),
            webview: None,
            coordinator: StartupCoordinator::default(),
            failure: None,
            startup,
        };
        if let Err(err) = begin_webview_result {
            app.fail("WebView2 could not be initialized.", err);
        }
        Ok(app)
    }

    /// Advance all callback-driven startup paths without blocking eframe's
    /// render loop.
    fn poll_startup(&mut self, context: &eframe::egui::Context) {
        if self.coordinator.status == StartupStatus::Failed {
            return;
        }

        self.poll_frontend();
        if self.coordinator.status == StartupStatus::Failed {
            return;
        }
        if self.coordinator.status == StartupStatus::Ready {
            return;
        }

        let webview_result = self.webview_result.borrow_mut().take();
        if let Some(result) = webview_result {
            match result {
                Ok(webview) => self.accept_webview(context, webview),
                Err(err) =>
                    self.fail("WebView2 could not be initialized.", err),
            }
        }
        if self.coordinator.status == StartupStatus::Failed {
            return;
        }

        let navigation_result = self.navigation_result.borrow_mut().take();
        if let Some(result) = navigation_result {
            match result {
                Ok(()) => self.coordinator.mark_ready(),
                Err(err) =>
                    self.fail("TurboDoc could not load its frontend.", err),
            }
        }
        if self.coordinator.status == StartupStatus::Failed {
            return;
        }

        if self.coordinator.navigation_timed_out(
            Instant::now(),
            INITIAL_NAVIGATION_TIMEOUT)
        {
            self.fail(
                "TurboDoc could not load its frontend.",
                anyhow::anyhow!(
                    "initial navigation did not complete within {:?}",
                    INITIAL_NAVIGATION_TIMEOUT));
            return;
        }

        if self.coordinator.begin_navigation_if_ready(Instant::now()) {
            self.startup.mark("Vite and WebView2 synchronized");
            let navigate_result =
                self.webview
                    .as_ref()
                    .expect("coordinator marked a missing WebView2 ready")
                    .navigate(&self.url);
            match navigate_result {
                Ok(()) => {
                    self.startup.mark("initial navigation requested");
                    context.request_repaint_after(INITIAL_NAVIGATION_TIMEOUT);
                },
                Err(err) =>
                    self.fail("TurboDoc could not begin navigation.", err),
            }
        }
    }

    /// Drain Vite lifecycle events so an exit queued immediately after
    /// readiness wins over beginning or retaining a frontend navigation.
    fn poll_frontend(&mut self) {
        loop {
            match self.frontend_rx.try_recv() {
                Ok(FrontendEvent::Ready) => {
                    if !self.coordinator.frontend_ready {
                        self.coordinator.mark_frontend_ready();
                        self.startup.mark("Vite frontend ready");
                    }
                },
                Ok(FrontendEvent::Exited(err)) => {
                    let summary = if self.coordinator.frontend_ready {
                        "The frontend stopped unexpectedly."
                    } else {
                        "The frontend failed to start."
                    };
                    self.fail(summary, err);
                    return;
                },
                Err(mpsc::TryRecvError::Empty) => return,
                Err(mpsc::TryRecvError::Disconnected) => {
                    self.fail(
                        "The frontend monitor stopped unexpectedly.",
                        anyhow::anyhow!("Vite lifecycle channel disconnected"));
                    return;
                },
            }
        }
    }

    /// Configure a newly created WebView2 controller, including its one-shot
    /// navigation completion callback, before marking it ready to navigate.
    fn accept_webview(
        &mut self,
        context: &eframe::egui::Context,
        webview: WebView) {
        if let Err(err) = webview.set_bounds(webview_bounds(self.webview_size)) {
            self.fail("WebView2 could not be sized.", err);
            return;
        }

        let result_slot = Rc::clone(&self.navigation_result);
        let repaint_context = context.clone();
        let setup_result = handler::setup(
            &self.window,
            &webview,
            &self.url,
            self.server.take().expect("WebView2 setup called twice"),
            self.startup,
            move |result| {
                if result_slot.replace(Some(result)).is_some() {
                    log::error!("initial navigation completed more than once");
                }
                repaint_context.request_repaint();
            });
        if let Err(err) = setup_result {
            self.fail("WebView2 event handlers could not be installed.", err);
            return;
        }

        self.webview = Some(webview);
        self.coordinator.mark_webview_ready();
        self.startup.mark("WebView2 wrapper ready");
    }

    /// Record an unrecoverable startup error for the extensible egui error
    /// surface. The full chain remains available through "Show details".
    fn fail(&mut self, summary: &'static str, error: anyhow::Error) {
        log::error!("{summary} {error:#}");
        // A post-startup Vite exit happens while the child controller covers
        // egui; hide it so the persistent native failure UI becomes visible.
        if let Some(webview) = &self.webview
            && let Err(err) = webview.set_visible(false)
        {
            log::error!("failed to hide WebView2 after startup failure: {err:#}");
        }
        self.failure = Some(StartupFailure {
            summary,
            details: format!("{error:#}"),
        });
        self.coordinator.mark_failed();
    }

    /// Keep the child controller exactly aligned with eframe's client area.
    fn resize_webview(&mut self) {
        let size = self.window.inner_size();
        if size == self.webview_size {
            return;
        }
        self.webview_size = size;
        if let Some(webview) = &self.webview
            && let Err(err) = webview.set_bounds(webview_bounds(size))
        {
            log::error!("failed to resize WebView2: {err:#}");
        }
    }

    /// Render the visible startup or failure state beneath the hidden child
    /// controller. The child becomes visible only after successful navigation.
    fn render_startup(&self, ui: &mut eframe::egui::Ui) {
        use eframe::egui::Align2;
        use eframe::egui::Area;
        use eframe::egui::Id;
        use eframe::egui::RichText;

        // An anchored Area sizes itself to its contents before centering.
        // `Ui::centered_and_justified` instead stretches a nested Ui to the
        // full client height, which leaves that nested content at the top.
        Area::new(Id::new("native_startup"))
            .anchor(Align2::CENTER_CENTER, eframe::egui::Vec2::ZERO)
            .movable(false)
            .interactable(false)
            .show(ui.ctx(), |ui| {
                ui.take_available_width();
                ui.vertical_centered(|ui| {
                    ui.add(eframe::egui::Spinner::new().size(28.0));
                    ui.add_space(14.0);
                    let message = match self.coordinator.status {
                        StartupStatus::Initializing => "Starting TurboDoc...",
                        StartupStatus::Navigating => "Loading Workspace...",
                        StartupStatus::Ready | StartupStatus::Failed => "",
                    };
                    ui.label(
                        RichText::new(message)
                            .size(15.0)
                            .color(eframe::egui::Color32::from_rgb(
                                190,
                                194,
                                204)));
                });
            });
    }

    /// Render an in-window startup error with copyable diagnostic details.
    fn render_failure(
        &self,
        ui: &mut eframe::egui::Ui,
        failure: &StartupFailure) {
        use eframe::egui::Align2;
        use eframe::egui::Area;
        use eframe::egui::Id;
        use eframe::egui::RichText;

        Area::new(Id::new("native_startup_failure"))
            .anchor(Align2::CENTER_CENTER, eframe::egui::Vec2::ZERO)
            .movable(false)
            .show(ui.ctx(), |ui| {
                ui.set_max_width(640.0);
                ui.vertical_centered(|ui| {
                    ui.heading(
                        RichText::new("TurboDoc couldn't start").size(24.0));
                    ui.add_space(10.0);
                    ui.label(
                        RichText::new(failure.summary)
                            .size(15.0)
                            .color(eframe::egui::Color32::from_rgb(
                                205,
                                208,
                                216)));
                    ui.add_space(18.0);
                    eframe::egui::CollapsingHeader::new("Show details")
                        .show(ui, |ui| {
                            ui.label(
                                RichText::new(&failure.details)
                                    .monospace()
                                    .color(eframe::egui::Color32::from_rgb(
                                        175,
                                        179,
                                        190)));
                        });
                    ui.add_space(14.0);
                    ui.horizontal(|ui| {
                        if ui.button("Copy details").clicked() {
                            ui.ctx().copy_text(failure.details.clone());
                        }
                        if ui.button("Exit").clicked() {
                            ui.ctx().send_viewport_cmd(
                                eframe::egui::ViewportCommand::Close);
                        }
                    });
                });
            });
    }
}

impl eframe::App for TurboDocApp {
    fn logic(
        &mut self,
        context: &eframe::egui::Context,
        _frame: &mut eframe::Frame) {
        self.poll_startup(context);
        self.resize_webview();
    }

    fn ui(
        &mut self,
        ui: &mut eframe::egui::Ui,
        _frame: &mut eframe::Frame) {
        ui.painter().rect_filled(ui.max_rect(), 0.0, startup_background());
        match (&self.coordinator.status, &self.failure) {
            (StartupStatus::Failed, Some(failure)) =>
                self.render_failure(ui, failure),
            (StartupStatus::Ready, _) => {},
            _ => self.render_startup(ui),
        }
    }

    fn clear_color(&self, _visuals: &eframe::egui::Visuals) -> [f32; 4] {
        let color = crate::startup::STARTUP_BACKGROUND;
        [
            f32::from(color.red) / 255.0,
            f32::from(color.green) / 255.0,
            f32::from(color.blue) / 255.0,
            1.0,
        ]
    }
}

/// Convert the shared startup color token into egui's packed sRGB color.
fn startup_background() -> eframe::egui::Color32 {
    let color = crate::startup::STARTUP_BACKGROUND;
    eframe::egui::Color32::from_rgb(color.red, color.green, color.blue)
}

/// Convert a physical client size into WebView2 child-window coordinates.
fn webview_bounds(size: PhysicalSize<u32>) -> RECT {
    RECT {
        left: 0,
        top: 0,
        right: size.width as _,
        bottom: size.height as _,
    }
}

/// Report failures that happen before egui's error surface can exist.
fn show_native_startup_error(error: &eframe::Error) {
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

fn open_external_link(window: &winit::window::Window, url: &str) {
    use native_dialog::*;

    let result = MessageDialogBuilder::default()
        .set_owner(window)
        .set_level(MessageLevel::Info)
        .set_title("Open External Link")
        .set_text(format!("Do you want to open this link in your default web browser?\n\n{url}"))
        .confirm()
        .show();
    match result {
        Ok(true) => {
            use nkcore::prelude::RawWindowHandleExt as _;
            use winit::raw_window_handle::HasWindowHandle as _;
            use windows::core::HSTRING;
            use windows::Win32::UI::Shell::ShellExecuteW;
            use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

            let hwnd = window.window_handle().unwrap().as_raw().as_hwnd();
            let url = HSTRING::from(url);
            // ShellExecuteW returns an HINSTANCE; values > 32 indicate success.
            let result = unsafe {
                ShellExecuteW(
                    Some(hwnd),
                    windows::core::w!("open"),
                    &url,
                    None,
                    None,
                    SW_SHOWNORMAL)
            };
            if result.0 as usize <= 32 {
                log::error!("ShellExecuteW failed with code {:?}", result.0);
            }
        },
        Ok(false) => {},
        Err(err) => {
            log::error!("failed to show dialog: {err}");
        }
    }
}

mod handler {
    use crate::prelude::*;
    use crate::server::Server;
    use crate::startup::StartupProbe;
    use crate::webview::WebView;
    use crate::webview::WebViewNavigationResult;

    use std::cell::RefCell;
    use std::collections::HashSet;
    use std::rc::Rc;
    use std::sync::Arc;
    use winit::window::Window;

    /// Host policy for a child-frame navigation request.
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum FrameNavigationKind {
        /// WebView2's implicit navigation for an iframe without a `src`.
        BlankBootstrap,
        /// Documentation that remains inside TurboDoc's viewer.
        Hosted,
        /// A destination that must be cancelled and offered to the OS browser.
        External,
    }

    /// Classify a child-frame URL before applying navigation side effects.
    ///
    /// Only the exact browser-generated `about:blank` URL bypasses normal URL
    /// policy. Other browser-internal schemes remain external and cancelled.
    fn classify_frame_navigation(url: &str) -> FrameNavigationKind {
        if url == "about:blank" {
            FrameNavigationKind::BlankBootstrap
        } else if crate::HOSTED_URL.iter().any(|&prefix| url.starts_with(prefix)) {
            FrameNavigationKind::Hosted
        } else {
            FrameNavigationKind::External
        }
    }

    /// Install WebView2 request and navigation handlers. `on_navigation`
    /// receives exactly one result for native startup, while the persistent
    /// completion handler also releases deferred iframe loading after later
    /// development-server reloads.
    pub fn setup<F>(
        window: &Arc<Window>,
        webview: &WebView,
        frontend_url: &str,
        server: Server,
        startup: StartupProbe,
        on_navigation: F)
     -> anyhow::Result<()>
    where
        F: FnOnce(anyhow::Result<()>) + 'static,
    {
        for uri_pattern in super::web_resource_request_filters(frontend_url) {
            webview.add_web_resource_requested_filter(&uri_pattern)?;
        }

        // The controller starts hidden to avoid exposing a partially loaded
        // WebView2 surface. Every successful frontend navigation reveals the
        // controller before notifying Svelte that iframe loading may begin;
        // retaining the handler also covers full Vite reloads.
        webview.on_navigation_completed({
            let webview = webview.clone();
            let mut initial_navigation = Some(on_navigation);
            move |result| {
                let is_initial = initial_navigation.is_some();
                let outcome =
                    on_frontend_navigation_completed(
                        &webview,
                        startup,
                        &result,
                        is_initial);
                if let Some(on_navigation) = initial_navigation.take() {
                    on_navigation(outcome);
                } else if let Err(err) = outcome {
                    log::error!("frontend reload failed: {err:#}");
                }
            }
        })?;

        // TurboDoc has no loopback backend server. This handler supplies the
        // in-process `/api/v1/*` routes and documentation proxy responses for
        // the exact filters above; returning `None` lets ordinary Vite assets
        // and HMR traffic continue through WebView2's network stack.
        webview.on_web_resource_requested(move |request| on_web_resource_requested(&server, request))?;

        // The documentation viewer is an iframe, so its navigations do not
        // pass through the top-level completion handler. Observe them here to
        // keep frontend navigation state synchronized and to cancel external
        // destinations before opening them in the system browser.
        let hosted_navigation_ids = Rc::new(RefCell::new(HashSet::new()));
        webview.on_frame_navigation_starting({
            let window = Arc::clone(window);
            let webview = webview.clone();
            let hosted_navigation_ids = Rc::clone(&hosted_navigation_ids);
            move |navigation_id, url, cancel_navigation| {
                on_frame_navigation_starting(
                    &window,
                    &webview,
                    &hosted_navigation_ids,
                    navigation_id,
                    url,
                    cancel_navigation);
            }
        })?;
        webview.on_frame_navigation_completed({
            let webview = webview.clone();
            let hosted_navigation_ids = Rc::clone(&hosted_navigation_ids);
            let mut first_document_completion = true;
            move |result| {
                let is_hosted_document = on_frame_navigation_completed(
                    &webview,
                    &hosted_navigation_ids,
                    &result);
                if is_hosted_document && first_document_completion {
                    startup.mark(&format!(
                        "initial document NavigationCompleted #{} ({})",
                        result.navigation_id,
                        if result.status.is_ok() { "success" } else { "failure" }));
                    first_document_completion = false;
                }
            }
        })?;

        Ok(())
    }

    /// Reveal the loaded frontend and release its deferred documentation load.
    ///
    /// `is_initial` controls startup telemetry only; successful reloads must
    /// repeat the same visibility-before-message ordering.
    fn on_frontend_navigation_completed(
        webview: &WebView,
        startup: StartupProbe,
        result: &WebViewNavigationResult,
        is_initial: bool)
     -> anyhow::Result<()> {
        match &result.status {
            Ok(()) => {
                webview.set_visible(true)?;
                webview.post_message_as_json(r#"{"type":"frontend-shown"}"#)?;
                if is_initial {
                    startup.mark(&format!(
                        "WebView2 NavigationCompleted #{}; controller shown; document loading released",
                        result.navigation_id));
                }
                Ok(())
            },
            Err(err) =>
                anyhow::bail!(
                    "navigation #{} failed to load frontend with status {err:?}",
                    result.navigation_id),
        }
    }

    /// Routes intercepted WebView2 requests to the in-process backend:
    ///
    /// - **Docs URLs** (`PROXIED_URL` prefixes, GET): through the proxy
    ///   cache + dark-mode injection pipeline.
    /// - **`/api/v1/*`** (any method): dispatched to the data/crates
    ///   handlers.
    /// - **Everything else**: returns `None` so WebView2 falls through to
    ///   its default path (frontend assets served by Vite, HMR WebSocket,
    ///   navigations to external sites).
    fn on_web_resource_requested(
        server: &Server,
        request: WebRequest)
     -> Option<WebResponse> {
        use http::Method;
        let uri = request.uri().to_string();

        if request.method() == Method::GET &&
            crate::PROXIED_URL.iter().any(|&prefix| uri.starts_with(prefix)) {
            return match server.fetch(&request) {
                Ok(response) => Some(response),
                Err(err) => {
                    log::error!("proxy request failed for {uri}: {err:#}");
                    None
                },
            };
        }

        if request.uri().path().starts_with("/api/v1/") {
            return Some(server.dispatch_api(request));
        }

        None
    }

    /// Intercepts iframe navigations.
    ///
    /// - Known documentation URLs: forward a `navigated` event to the frontend
    ///   so it can update the sidebar (version selector, current item highlight).
    /// - Blank iframe bootstrap: allow WebView2's implicit `about:blank` without
    ///   treating it as document content.
    /// - External URLs: cancel navigation and offer to open in the system browser.
    fn on_frame_navigation_starting(
        window: &Window,
        webview: &WebView,
        hosted_navigation_ids: &RefCell<HashSet<u64>>,
        navigation_id: u64,
        url: &str,
        cancel_navigation: Box<dyn FnOnce()>) {
        log::info!("navigating to {url}");
        match classify_frame_navigation(url) {
            FrameNavigationKind::BlankBootstrap =>
                log::debug!(" -> blank iframe bootstrap allowed"),
            FrameNavigationKind::Hosted => {
                hosted_navigation_ids.borrow_mut().insert(navigation_id);
                // Notify frontend of navigation so it can update the sidebar.
                let message = serde_json::json!({
                    "type": "navigated",
                    "url": url,
                    "navigationId": navigation_id.to_string(),
                }).to_string();
                let _ = webview.post_message_as_json(&message)
                    .inspect_err(|err| log::error!("failed to send navigated: {err}"));
            },
            FrameNavigationKind::External => {
                log::info!(" -> external link, navigation cancelled");
                cancel_navigation();
                super::open_external_link(window, url);
            },
        }
    }

    /// Report completion only for frame navigations accepted by TurboDoc.
    ///
    /// Returning `true` lets the caller record the first document-completion
    /// milestone without logging unrelated or cancelled external frames.
    fn on_frame_navigation_completed(
        webview: &WebView,
        hosted_navigation_ids: &RefCell<HashSet<u64>>,
        result: &WebViewNavigationResult)
     -> bool {
        if !hosted_navigation_ids.borrow_mut().remove(&result.navigation_id) {
            return false;
        }

        let error = result.status.as_ref().err().map(|status| format!("{status:?}"));
        let message = serde_json::json!({
            "type": "document-navigation-completed",
            "navigationId": result.navigation_id.to_string(),
            "success": result.status.is_ok(),
            "error": error,
        }).to_string();
        let _ = webview.post_message_as_json(&message)
            .inspect_err(|err| {
                log::error!("failed to send document-navigation-completed: {err}")
            });
        true
    }

    #[cfg(test)]
    mod tests {
        use super::classify_frame_navigation;
        use super::FrameNavigationKind;

        #[test]
        fn sourceless_iframe_bootstrap_is_allowed() {
            assert_eq!(
                classify_frame_navigation("about:blank"),
                FrameNavigationKind::BlankBootstrap);
        }

        #[test]
        fn other_browser_internal_urls_remain_external() {
            assert_eq!(
                classify_frame_navigation("about:srcdoc"),
                FrameNavigationKind::External);
        }

        #[test]
        fn documentation_url_remains_hosted() {
            assert_eq!(
                classify_frame_navigation("https://docs.rs/serde/latest/serde/"),
                FrameNavigationKind::Hosted);
        }

        #[test]
        fn unsupported_https_url_remains_external() {
            assert_eq!(
                classify_frame_navigation("https://example.com/"),
                FrameNavigationKind::External);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;
    use std::time::Instant;

    use super::StartupCoordinator;
    use super::StartupStatus;
    use super::web_resource_request_filters;

    #[test]
    fn startup_waits_for_both_independent_readiness_paths() {
        let now = Instant::now();
        let mut frontend_first = StartupCoordinator::default();
        frontend_first.mark_frontend_ready();
        assert!(!frontend_first.begin_navigation_if_ready(now));
        frontend_first.mark_webview_ready();
        assert!(frontend_first.begin_navigation_if_ready(now));
        assert!(!frontend_first.begin_navigation_if_ready(now));

        let mut webview_first = StartupCoordinator::default();
        webview_first.mark_webview_ready();
        assert!(!webview_first.begin_navigation_if_ready(now));
        webview_first.mark_frontend_ready();
        assert!(webview_first.begin_navigation_if_ready(now));
        assert!(!webview_first.begin_navigation_if_ready(now));
    }

    #[test]
    fn startup_success_and_failure_are_terminal() {
        let now = Instant::now();
        let mut successful = StartupCoordinator::default();
        successful.mark_frontend_ready();
        successful.mark_webview_ready();
        assert!(successful.begin_navigation_if_ready(now));
        successful.mark_ready();
        assert_eq!(successful.status, StartupStatus::Ready);
        assert!(!successful.begin_navigation_if_ready(now));

        let mut failed = StartupCoordinator::default();
        failed.mark_frontend_ready();
        failed.mark_webview_ready();
        failed.mark_failed();
        assert_eq!(failed.status, StartupStatus::Failed);
        assert!(!failed.begin_navigation_if_ready(now));
    }

    #[test]
    fn initial_navigation_timeout_is_bounded_at_the_deadline() {
        let started_at = Instant::now();
        let timeout = Duration::from_secs(30);
        let mut coordinator = StartupCoordinator::default();
        coordinator.mark_frontend_ready();
        coordinator.mark_webview_ready();
        assert!(coordinator.begin_navigation_if_ready(started_at));

        assert!(!coordinator.navigation_timed_out(
            started_at + timeout - Duration::from_millis(1),
            timeout));
        assert!(coordinator.navigation_timed_out(started_at + timeout, timeout));
    }

    #[test]
    fn web_resource_filters_are_scoped_to_handled_urls() {
        assert_eq!(
            web_resource_request_filters("http://localhost:5173/"),
            [
                "https://docs.rs/*",
                "https://doc.rust-lang.org/*",
                "https://microsoft.github.io/windows-docs-rs/doc/*",
                "https://index.crates.io/*",
                "https://crates.io/api/v1/crates/*",
                "http://localhost:5173/api/v1/*",
            ]);
    }
}
