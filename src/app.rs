use nkcore::prelude::*;

use crate::dev;
use crate::server::Server;
use crate::startup::StartupProbe;
use crate::webview::WebView;

use std::cell::RefCell;
use std::path::Path;
use std::path::PathBuf;
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

/// Reserved virtual host used only for executable-adjacent release assets.
const RELEASE_FRONTEND_HOST: &str = "turbodoc.example";
/// Origin of the executable-adjacent release frontend.
const RELEASE_FRONTEND_ORIGIN: &str = "https://turbodoc.example";
/// Unmapped release origin whose `/api/*` requests reach `WebResourceRequested`.
///
/// WebView2 does not raise that event for URLs claimed by a virtual-host folder
/// mapping, so release APIs cannot share [`RELEASE_FRONTEND_ORIGIN`].
const RELEASE_API_ORIGIN: &str = "https://api.turbodoc.example";
/// Persistence metadata JavaScript must read across the release origin split.
const RESOURCE_EXISTS_HEADER: &str = "x-turbodoc-resource-exists";
/// Explicit entry document because virtual-host mappings do not add directory
/// index behavior.
const RELEASE_FRONTEND_URL: &str = "https://turbodoc.example/index.html";

/// Runtime frontend behavior relevant to shared host startup and routing.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FrontendKind {
    /// Load optimized static artifacts through WebView2 folder mapping.
    Release,
    /// Wait for a host-owned Vite child and preserve HMR.
    Dev,
}

/// Frontend source selected by the CLI before native startup begins.
pub enum FrontendSource {
    /// Executable-adjacent Vite build artifacts.
    Release {
        /// Directory mapped to [`RELEASE_FRONTEND_HOST`].
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
    fn kind(&self) -> FrontendKind {
        match self {
            Self::Release { .. } => FrontendKind::Release,
            Self::Dev(_) => FrontendKind::Dev,
        }
    }

    /// Return the origin used to scope intercepted application API requests.
    fn api_origin(&self) -> &str {
        match self {
            Self::Release { .. } => RELEASE_API_ORIGIN,
            Self::Dev(frontend) => frontend.origin(),
        }
    }

    /// Return the initial top-level WebView2 destination.
    fn url(&self) -> &str {
        match self {
            Self::Release { .. } => RELEASE_FRONTEND_URL,
            Self::Dev(frontend) => frontend.origin(),
        }
    }

    /// Borrow the release artifact directory when folder mapping is required.
    fn release_public_dir(&self) -> Option<&Path> {
        match self {
            Self::Release { public_dir } => Some(public_dir),
            Self::Dev(_) => None,
        }
    }
}

/// Build the exact WebView2 URL patterns whose requests TurboDoc handles.
///
/// Proxy bases end in `/`, so appending `*` cannot accidentally match a
/// longer hostname. The API patterns are scoped to the selected API origin
/// instead of intercepting unrelated traffic. Both
/// `/api` and its descendants are covered so unknown API requests cannot fall
/// through to frontend asset handling.
fn web_resource_request_filters(api_origin: &str) -> Vec<String> {
    let proxy_filters =
        crate::PROXIED_URL
            .iter()
            .map(|base_url| format!("{base_url}*"));
    let api_origin = api_origin.trim_end_matches('/');
    let api_filters = [
        format!("{api_origin}/api"),
        format!("{api_origin}/api/*"),
    ];
    proxy_filters
        .chain(api_filters)
        .collect()
}

/// Run the eframe host while the selected frontend and WebView2 initialize.
///
/// eframe owns the root winit window and wgpu surface. WebView2 is created
/// asynchronously as a child of that same HWND, so egui can keep rendering
/// startup progress until the selected frontend and controller are ready.
/// `scale_factor` is the CLI-validated content zoom, independent of native DPI.
pub fn run(
    frontend: FrontendSource,
    server: Server,
    scale_factor: f64,
    startup: StartupProbe) {
    let frontend_kind = frontend.kind();
    let api_origin = frontend.api_origin().to_owned();
    let url = frontend.url().to_owned();
    let release_public_dir = frontend.release_public_dir().map(Path::to_path_buf);

    // Start Vite before eframe initializes wgpu so the two slower dev paths
    // overlap. Release mode has neither a lifecycle channel nor child process.
    let frontend_repaint = Arc::new(OnceLock::<eframe::egui::Context>::new());
    let dev_rx = match frontend {
        FrontendSource::Dev(frontend) => {
            let (dev_tx, dev_rx) = mpsc::channel();
            let callback_repaint = Arc::clone(&frontend_repaint);
            frontend.spawn(startup, move |event| {
                if dev_tx.send(event).is_err() {
                    log::debug!("discarding Vite lifecycle event after eframe shutdown");
                    return;
                }
                if let Some(context) = callback_repaint.get() {
                    context.request_repaint();
                }
            });
            Some(dev_rx)
        },
        FrontendSource::Release { .. } => {
            startup.mark("release frontend artifacts selected");
            None
        },
    };
    let active_frontend = ActiveFrontend {
        kind: frontend_kind,
        api_origin,
        url,
        release_public_dir,
        dev_rx,
    };

    let native_options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_inner_size([1680.0, 1050.0]),
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
                active_frontend,
                server,
                scale_factor,
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

/// Synchronizes the selected frontend and WebView2 readiness paths.
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

impl StartupCoordinator {
    /// Initialize release mode as locally ready while dev mode waits for Vite.
    fn new(frontend_kind: FrontendKind) -> Self {
        Self {
            frontend_ready: frontend_kind == FrontendKind::Release,
            webview_ready: false,
            navigation_started_at: None,
            status: StartupStatus::Initializing,
        }
    }
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

/// Selected frontend state retained after any dev process has been spawned.
struct ActiveFrontend {
    /// Behavior used by readiness coordination and API ownership.
    kind: FrontendKind,
    /// Origin used to scope intercepted `/api/*` requests.
    api_origin: String,
    /// Initial top-level WebView2 navigation destination.
    url: String,
    /// Release directory requiring virtual-host mapping, if selected.
    release_public_dir: Option<PathBuf>,
    /// Dev-only Vite lifecycle receiver; absent in release mode.
    dev_rx: Option<mpsc::Receiver<dev::Event>>,
}

/// Native application state shared by the splash UI and WebView2 host.
struct TurboDocApp {
    window: Arc<Window>,
    frontend: ActiveFrontend,
    server: Option<Server>,
    webview_result: Rc<RefCell<Option<anyhow::Result<WebView>>>>,
    navigation_result: Rc<RefCell<Option<anyhow::Result<()>>>>,
    webview: Option<WebView>,
    webview_size: PhysicalSize<u32>,
    /// CLI-validated content zoom applied while the controller is still hidden.
    scale_factor: f64,
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
        frontend: ActiveFrontend,
        server: Server,
        scale_factor: f64,
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
            server: Some(server),
            coordinator: StartupCoordinator::new(frontend.kind),
            frontend,
            webview_result,
            navigation_result: Rc::new(RefCell::new(None)),
            webview: None,
            scale_factor,
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

        self.poll_dev_frontend();
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
            self.startup.mark("frontend and WebView2 synchronized");
            let navigate_result =
                self.webview
                    .as_ref()
                    .expect("coordinator marked a missing WebView2 ready")
                    .navigate(&self.frontend.url);
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

    /// Drain dev-mode Vite lifecycle events so an exit queued immediately
    /// after readiness wins over beginning or retaining a navigation.
    fn poll_dev_frontend(&mut self) {
        if self.frontend.dev_rx.is_none() {
            return;
        }
        loop {
            let event = self.frontend.dev_rx
                .as_ref()
                .expect("dev receiver disappeared while polling")
                .try_recv();
            match event {
                Ok(dev::Event::Ready) => {
                    if !self.coordinator.frontend_ready {
                        self.coordinator.mark_frontend_ready();
                        self.startup.mark("Vite frontend ready");
                    }
                },
                Ok(dev::Event::Exited(err)) => {
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

        // Configure the default zoom before navigation so the first visible
        // frontend paint already uses the requested scale.
        if let Err(err) = webview.set_zoom_factor(self.scale_factor) {
            self.fail("WebView2 content scale could not be configured.", err);
            return;
        }

        if let Some(public_dir) = self.frontend.release_public_dir.as_deref()
            && let Err(err) = configure_release_frontend(&webview, public_dir)
        {
            self.fail("TurboDoc could not load its release frontend.", err);
            return;
        }

        let result_slot = Rc::clone(&self.navigation_result);
        let repaint_context = context.clone();
        let setup_result = handler::setup(
            &self.window,
            &webview,
            &self.frontend.api_origin,
            self.frontend.kind,
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

    fn on_exit(&mut self) {
        // Creation may complete after the last logic pass but before eframe
        // begins shutdown, leaving the new controller in the callback slot.
        let pending_webview =
            self.webview_result
                .borrow_mut()
                .take()
                .and_then(Result::ok);
        let webview = self.webview.take().or(pending_webview);
        if let Some(webview) = webview
            && let Err(err) = webview.close()
        {
            log::error!("failed to close WebView2 during host shutdown: {err:#}");
        }
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

/// Validate and map executable-adjacent release assets before navigation.
fn configure_release_frontend(webview: &WebView, public_dir: &Path) -> anyhow::Result<()> {
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

    use anyhow::Context as _;
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

    /// Queue a direct call to one named function under `window.__turboDoc__`.
    ///
    /// `member` is supplied only by trusted native call sites. The argument is
    /// serialized as JSON before entering the generated JavaScript source.
    ///
    /// # Errors
    ///
    /// Returns an error when argument serialization fails or WebView2 rejects
    /// the newly active script synchronously.
    fn call_frontend(
        webview: &WebView,
        member: &str,
        argument: Option<&serde_json::Value>)
     -> anyhow::Result<()> {
        webview.execute_script(frontend_call_source(member, argument)?)
    }

    /// Build an availability-checking call to one trusted frontend member.
    fn frontend_call_source(
        member: &str,
        argument: Option<&serde_json::Value>)
     -> anyhow::Result<String> {
        let argument =
            argument
                .map(serde_json::to_string)
                .transpose()
                .context("failed to serialize frontend function argument")?
                .unwrap_or_default();
        Ok(format!(
            "(() => {{\n\
             \x20   const api = window.__turboDoc__;\n\
             \x20   if (typeof api?.{member} !== \"function\") {{\n\
             \x20       throw new Error(\"TurboDoc frontend function is unavailable: {member}\");\n\
             \x20   }}\n\
             \x20   api.{member}({argument});\n\
             }})()"))
    }

    /// Install WebView2 request and navigation handlers. `on_navigation`
    /// receives exactly one result for native startup, while the persistent
    /// completion handler also releases deferred iframe loading after later
    /// development-server reloads.
    pub fn setup<F>(
        window: &Arc<Window>,
        webview: &WebView,
        api_origin: &str,
        frontend_kind: super::FrontendKind,
        server: Server,
        startup: StartupProbe,
        on_navigation: F)
     -> anyhow::Result<()>
    where
        F: FnOnce(anyhow::Result<()>) + 'static,
    {
        for uri_pattern in super::web_resource_request_filters(api_origin) {
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
        // in-process `/api/*` routes and documentation proxy responses for
        // the exact filters above; returning `None` lets ordinary frontend
        // resources continue through WebView2's selected source.
        webview.on_web_resource_requested(move |request|
            on_web_resource_requested(&server, frontend_kind, request))?;

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
    /// repeat the same visibility-before-call ordering.
    fn on_frontend_navigation_completed(
        webview: &WebView,
        startup: StartupProbe,
        result: &WebViewNavigationResult,
        is_initial: bool)
     -> anyhow::Result<()> {
        match &result.status {
            Ok(()) => {
                webview.set_visible(true)?;
                call_frontend(webview, "frontendShown", None)?;
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
    /// - **Dev `/api/ready`**: passed through to Vite's readiness handler.
    /// - **Release API preflights**: answered with the narrow policy required
    ///   by the separate, unmapped API origin.
    /// - **Every other `/api` request**: dispatched to Rust, where persistence
    ///   owns generic `/api/data/{data_id}` and per-source
    ///   `/api/sources/{source_id}` routes and rejects unknown routes; release
    ///   responses authorize only the mapped frontend origin.
    /// - **Everything else**: returns `None` so WebView2 falls through to
    ///   its default path (release asset mapping or Vite/HMR in dev mode,
    ///   plus navigations to external sites).
    fn on_web_resource_requested(
        server: &Server,
        frontend_kind: super::FrontendKind,
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

        match api_request_handler(
            frontend_kind,
            request.method(),
            request.uri().path()) {
            Some(ApiRequestHandler::Rust) => {
                let response = server.dispatch_api(request);
                return Some(match frontend_kind {
                    super::FrontendKind::Release =>
                        with_release_api_cors(response),
                    super::FrontendKind::Dev => response,
                });
            },
            Some(ApiRequestHandler::ReleasePreflight) =>
                return Some(release_api_preflight_response()),
            Some(ApiRequestHandler::Vite) => return None,
            None => {},
        }

        None
    }

    /// Owner of a request inside the frontend's `/api` namespace.
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum ApiRequestHandler {
        /// The in-process Rust dispatcher handles persistence and rejections.
        Rust,
        /// The host answers a release-mode cross-origin preflight directly.
        ReleasePreflight,
        /// Vite handles its launch-token-protected readiness route.
        Vite,
    }

    /// Classify frontend API paths without prefix ambiguity.
    ///
    /// `/api/ready` is Vite-owned only in dev mode. Rust receives the entire
    /// release namespace and all remaining dev paths so unknown routes get an
    /// explicit response instead of falling through to frontend content.
    /// Release `OPTIONS` requests are separated because the API has a distinct
    /// origin from the mapped static frontend.
    fn api_request_handler(
        frontend_kind: super::FrontendKind,
        method: &http::Method,
        path: &str)
     -> Option<ApiRequestHandler> {
        if frontend_kind == super::FrontendKind::Dev && path == "/api/ready" {
            Some(ApiRequestHandler::Vite)
        } else if frontend_kind == super::FrontendKind::Release
            && *method == http::Method::OPTIONS
            && (path == "/api" || path.starts_with("/api/"))
        {
            Some(ApiRequestHandler::ReleasePreflight)
        } else if path == "/api" || path.starts_with("/api/") {
            Some(ApiRequestHandler::Rust)
        } else {
            None
        }
    }

    /// Authorize one release API response for the mapped frontend only.
    ///
    /// The exact origin deliberately prevents hosted documentation frames from
    /// reading application data even though their requests share this WebView2.
    fn with_release_api_cors(mut response: WebResponse) -> WebResponse {
        response.headers_mut().insert(
            http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
            http::HeaderValue::from_static(super::RELEASE_FRONTEND_ORIGIN));
        response.headers_mut().insert(
            http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
            http::HeaderValue::from_static(super::RESOURCE_EXISTS_HEADER));
        response.headers_mut().append(
            http::header::VARY,
            http::HeaderValue::from_static("Origin"));
        response
    }

    /// Build the fixed preflight response for release-mode application data.
    fn release_api_preflight_response() -> WebResponse {
        let mut response = WebResponse::new(Vec::new());
        *response.status_mut() = http::StatusCode::NO_CONTENT;
        response.headers_mut().insert(
            http::header::ACCESS_CONTROL_ALLOW_METHODS,
            http::HeaderValue::from_static("GET, PUT, OPTIONS"));
        response.headers_mut().insert(
            http::header::ACCESS_CONTROL_ALLOW_HEADERS,
            http::HeaderValue::from_static("Content-Type"));
        response.headers_mut().insert(
            http::header::ACCESS_CONTROL_MAX_AGE,
            http::HeaderValue::from_static("600"));
        response.headers_mut().insert(
            http::header::CONTENT_LENGTH,
            http::HeaderValue::from_static("0"));
        with_release_api_cors(response)
    }

    /// Intercepts iframe navigations.
    ///
    /// - Known documentation URLs: call the frontend navigation-start function
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
                let report = serde_json::json!({
                    "url": url,
                    "navigationId": navigation_id.to_string(),
                });
                let _ = call_frontend(
                    webview,
                    "documentNavigationStarted",
                    Some(&report))
                    .inspect_err(|err| {
                        log::error!("failed to report document navigation start: {err}")
                    });
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
        let report = serde_json::json!({
            "navigationId": result.navigation_id.to_string(),
            "success": result.status.is_ok(),
            "error": error,
        });
        let _ = call_frontend(
            webview,
            "documentNavigationCompleted",
            Some(&report))
            .inspect_err(|err| {
                log::error!("failed to report document navigation completion: {err}")
            });
        true
    }

    #[cfg(test)]
    mod tests {
        use super::api_request_handler;
        use super::ApiRequestHandler;
        use super::classify_frame_navigation;
        use super::frontend_call_source;
        use super::FrameNavigationKind;
        use super::release_api_preflight_response;
        use super::with_release_api_cors;
        use crate::app::FrontendKind;

        #[test]
        fn frontend_call_source_round_trips_untrusted_argument_as_json() {
            let report = serde_json::json!({
                "url": "https://docs.rs/\"); globalThis.hacked = true; //\nserde/",
                "navigationId": "18446744073709551615",
            });
            let source =
                frontend_call_source("documentNavigationStarted", Some(&report))
                    .expect("frontend source should build");
            let argument =
                source
                    .lines()
                    .find_map(|line| {
                        line.trim()
                            .strip_prefix("api.documentNavigationStarted(")
                            .and_then(|line| line.strip_suffix(");"))
                    })
                    .expect("source should contain direct frontend call");

            assert_eq!(
                serde_json::from_str::<serde_json::Value>(argument)
                    .expect("argument should remain valid JSON"),
                report);
        }

        #[test]
        fn frontend_call_source_omits_argument_for_frontend_shown() {
            let source =
                frontend_call_source("frontendShown", None)
                    .expect("frontend source should build");

            assert!(source.contains("api.frontendShown();"), "source was: {source}");
        }

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
        fn general_documentation_urls_remain_hosted() {
            for url in [
                "https://en.wikipedia.org/wiki/Rust_(programming_language)",
                "https://minecraft.wiki/w/Redstone",
                concat!(
                    "https://zh.minecraft.wiki/w/",
                    "%E8%8D%AF%E6%B0%B4%E9%85%BF%E9%80%A0?variant=zh-cn#Ingredients"),
            ] {
                assert_eq!(classify_frame_navigation(url), FrameNavigationKind::Hosted);
            }
        }

        #[test]
        fn lookalike_documentation_hostname_remains_external() {
            for url in [
                "https://docs.rs.example.com/serde/latest/serde/",
                "https://minecraft.wiki.example.com/w/Redstone",
                "https://zh.minecraft.wiki.example.com/w/Redstone",
                "https://other.zh.minecraft.wiki/w/Redstone",
                "https://zh.minecraft.wiki@evil.example/w/Redstone",
            ] {
                assert_eq!(classify_frame_navigation(url), FrameNavigationKind::External);
            }
        }

        #[test]
        fn unsupported_https_url_remains_external() {
            assert_eq!(
                classify_frame_navigation("https://example.com/"),
                FrameNavigationKind::External);
        }

        #[test]
        fn data_api_is_owned_by_rust() {
            assert_eq!(
                api_request_handler(
                    FrontendKind::Dev,
                    &http::Method::GET,
                    "/api/data/rust"),
                Some(ApiRequestHandler::Rust));
        }

        #[test]
        fn source_api_is_owned_by_rust() {
            assert_eq!(
                api_request_handler(
                    FrontendKind::Dev,
                    &http::Method::GET,
                    "/api/sources/rust-crates"),
                Some(ApiRequestHandler::Rust));
        }

        #[test]
        fn ready_api_is_owned_by_vite_in_dev_mode() {
            assert_eq!(
                api_request_handler(
                    FrontendKind::Dev,
                    &http::Method::GET,
                    "/api/ready"),
                Some(ApiRequestHandler::Vite));
        }

        #[test]
        fn ready_api_is_rejected_by_rust_in_release_mode() {
            assert_eq!(
                api_request_handler(
                    FrontendKind::Release,
                    &http::Method::GET,
                    "/api/ready"),
                Some(ApiRequestHandler::Rust));
        }

        #[test]
        fn unknown_api_is_rejected_by_rust() {
            assert_eq!(
                api_request_handler(
                    FrontendKind::Dev,
                    &http::Method::GET,
                    "/api/database"),
                Some(ApiRequestHandler::Rust));
        }

        #[test]
        fn api_prefix_without_separator_is_not_intercepted() {
            assert_eq!(
                api_request_handler(
                    FrontendKind::Dev,
                    &http::Method::GET,
                    "/apiary"),
                None);
        }

        #[test]
        fn release_options_are_owned_by_the_preflight_policy() {
            assert_eq!(
                api_request_handler(
                    FrontendKind::Release,
                    &http::Method::OPTIONS,
                    "/api/data/rust"),
                Some(ApiRequestHandler::ReleasePreflight));
        }

        #[test]
        fn release_preflight_exposes_only_the_application_api_contract() {
            let response = release_api_preflight_response();

            assert_eq!(
                (
                    response.status(),
                    response.headers()[http::header::ACCESS_CONTROL_ALLOW_ORIGIN]
                        .to_str().expect("static origin header should be text"),
                    response.headers()[http::header::ACCESS_CONTROL_ALLOW_METHODS]
                        .to_str().expect("static method header should be text"),
                    response.headers()[http::header::ACCESS_CONTROL_ALLOW_HEADERS]
                        .to_str().expect("static allowed-header value should be text"),
                    response.headers()[http::header::ACCESS_CONTROL_EXPOSE_HEADERS]
                        .to_str().expect("static exposed-header value should be text"),
                    response.headers()[http::header::ACCESS_CONTROL_MAX_AGE]
                        .to_str().expect("static max-age header should be text")),
                (
                    http::StatusCode::NO_CONTENT,
                    "https://turbodoc.example",
                    "GET, PUT, OPTIONS",
                    "Content-Type",
                    "x-turbodoc-resource-exists",
                    "600"));
        }

        #[test]
        fn release_cors_preserves_backend_error_responses() {
            let response = with_release_api_cors(
                http::Response::builder()
                    .status(http::StatusCode::NOT_FOUND)
                    .body(b"not found".to_vec())
                    .expect("test response should build"));

            assert_eq!(
                (
                    response.status(),
                    response.body().as_slice(),
                    response.headers()[http::header::ACCESS_CONTROL_ALLOW_ORIGIN]
                        .to_str().expect("static origin header should be text"),
                    response.headers()[http::header::ACCESS_CONTROL_EXPOSE_HEADERS]
                        .to_str().expect("static exposed-header value should be text")),
                (
                    http::StatusCode::NOT_FOUND,
                    b"not found".as_slice(),
                    "https://turbodoc.example",
                    "x-turbodoc-resource-exists"));
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::time::Duration;
    use std::time::Instant;

    use super::FrontendKind;
    use super::FrontendSource;
    use super::RELEASE_API_ORIGIN;
    use super::RELEASE_FRONTEND_ORIGIN;
    use super::StartupCoordinator;
    use super::StartupStatus;
    use super::web_resource_request_filters;

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
    fn web_resource_filters_are_scoped_to_handled_urls() {
        assert_eq!(
            web_resource_request_filters("http://localhost:5173/"),
            [
                "https://docs.rs/*",
                "https://doc.rust-lang.org/*",
                "https://rust-analyzer.github.io/book/*",
                "https://rustc-dev-guide.rust-lang.org/*",
                "https://rust-lang.github.io/rustup/*",
                "https://microsoft.github.io/windows-docs-rs/doc/*",
                "https://en.wikipedia.org/*",
                "https://minecraft.wiki/*",
                "https://zh.minecraft.wiki/*",
                "https://index.crates.io/*",
                "https://crates.io/api/v1/crates/*",
                "http://localhost:5173/api",
                "http://localhost:5173/api/*",
            ]);
    }

    /// Documentation hosts must not admit sibling projects, lookalikes or credentials.
    #[test]
    fn documentation_url_scopes_reject_siblings_and_lookalikes() {
        for url in [
            "https://rust-analyzer.github.io/bookshop/",
            "https://rust-analyzer.github.io.example.com/book/",
            "https://rust-lang.github.io/other-project/",
            "https://rustc-dev-guide.rust-lang.org.example.com/",
            "https://minecraft.wiki.example.com/w/Redstone",
            "https://zh.minecraft.wiki.example.com/w/Redstone",
            "https://evilzh.minecraft.wiki/w/Redstone",
            "https://other.zh.minecraft.wiki/w/Redstone",
            "https://de.minecraft.wiki/w/Redstone",
            "http://zh.minecraft.wiki/w/Redstone",
            "https://zh.minecraft.wiki:8443/w/Redstone",
            "https://user:password@zh.minecraft.wiki/w/Redstone",
            "https://zh.minecraft.wiki@evil.example/w/Redstone",
        ] {
            assert!(!crate::HOSTED_URL.iter().any(|prefix| url.starts_with(prefix)));
            assert!(!crate::PROXIED_URL.iter().any(|prefix| url.starts_with(prefix)));
        }
    }

    #[test]
    fn release_api_filters_use_an_unmapped_origin() {
        let filters = web_resource_request_filters(RELEASE_API_ORIGIN);
        let expected_api_filters = [
            "https://api.turbodoc.example/api".to_owned(),
            "https://api.turbodoc.example/api/*".to_owned(),
        ];

        assert_eq!(
            (
                RELEASE_API_ORIGIN != RELEASE_FRONTEND_ORIGIN,
                &filters[crate::PROXIED_URL.len()..]),
            (
                true,
                expected_api_filters.as_slice()));
    }

    #[test]
    fn release_startup_waits_only_for_webview_readiness() {
        let now = Instant::now();
        let mut coordinator = StartupCoordinator::new(FrontendKind::Release);

        assert!(!coordinator.begin_navigation_if_ready(now));
        coordinator.mark_webview_ready();
        assert!(coordinator.begin_navigation_if_ready(now));
    }

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
