//! Native event-loop orchestration and application composition root.

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::mpsc;
use std::time::Instant;

use anyhow::Context as _;
use nkcore::prelude::*;
use windows::Win32::Foundation::RECT;
use winit::dpi::LogicalSize;
use winit::dpi::PhysicalSize;
use winit::event::WindowEvent;
use winit::event_loop::ActiveEventLoop;
use winit::event_loop::ControlFlow;
use winit::event_loop::EventLoop;
use winit::event_loop::EventLoopProxy;
use winit::window::Theme;
use winit::window::Window;
use winit::window::WindowAttributes;

use crate::dev;
use crate::server::Server;
use crate::startup::StartupProbe;
use crate::webview::WebView;

use super::HostEvent;
use super::frontend;
use super::frontend::FrontendKind;
use super::frontend::FrontendSource;
use super::lifecycle::INITIAL_NAVIGATION_TIMEOUT;
use super::lifecycle::StartupCoordinator;
use super::lifecycle::StartupStatus;
use super::lifecycle::window_presentation;
use super::splash::SplashSurface;
use super::splash::StartupFailure;
use super::splash::center_window;
use super::splash::show_native_startup_error;
use super::webview_handlers;

/// Logical client size used when the Mica workbench first becomes visible.
const WORKBENCH_SIZE: LogicalSize<f64> = LogicalSize::new(1280.0, 800.0);

/// Run the two-window native host while the selected frontend initializes.
///
/// The compact splash is the only wgpu surface. The independently owned,
/// initially hidden workbench hosts WebView2 directly over its Mica backdrop.
pub fn run(
    frontend: FrontendSource,
    server: Server,
    startup: StartupProbe) {
    use nkcore::winit::EventLoopExt as _;

    let mut event_loop = match EventLoop::<HostEvent>::with_user_event().build() {
        Ok(event_loop) => event_loop,
        Err(err) => {
            log::error!("failed to create native event loop: {err:#}");
            show_native_startup_error(&err);
            return;
        },
    };
    let event_loop_proxy = event_loop.create_proxy();
    let frontend_kind = frontend.kind();
    let api_origin = frontend.api_origin().to_owned();
    let url = frontend.url().to_owned();
    let release_public_dir = frontend.release_public_dir().map(PathBuf::from);

    // Start Vite before the splash initializes wgpu so the two slower dev
    // paths overlap. Release mode has neither a channel nor child process.
    let dev_rx = match frontend {
        FrontendSource::Dev(frontend) => {
            let (dev_tx, dev_rx) = mpsc::channel();
            let callback_proxy = event_loop_proxy.clone();
            frontend.spawn(startup, move |event| {
                if dev_tx.send(event).is_err() {
                    log::debug!("discarding Vite lifecycle event after native host shutdown");
                    return;
                }
                callback_proxy.send_event(HostEvent::Wake).ok();
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

    let host_proxy = event_loop_proxy.clone();
    let run_result = event_loop.run_app_with(move |active_event_loop| {
        let host = TurboDocHost::new(
            active_event_loop,
            host_proxy,
            active_frontend,
            server,
            startup);
        let mut host = match host {
            Ok(host) => Some(host),
            Err(err) => {
                log::error!("native host initialization failed: {err:#}");
                show_native_startup_error(&err);
                active_event_loop.exit();
                None
            },
        };
        move |active_event_loop, event| {
            if let Some(host) = &mut host {
                host.handle_event(active_event_loop, event);
            }
        }
    });
    if let Err(err) = run_result {
        log::error!("native host failed: {err:#}");
        show_native_startup_error(&err);
    }
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

/// Native application state captured by nkcore's closure-oriented event loop.
struct TurboDocHost {
    /// Hidden-until-ready Mica workbench that owns the WebView2 child HWND.
    workbench_window: Arc<Window>,
    /// Compact native startup and error surface.
    splash: SplashSurface,
    /// Selected frontend source and any dev lifecycle receiver.
    frontend: ActiveFrontend,
    /// In-process backend moved into WebView2 handlers exactly once.
    server: Option<Server>,
    /// Completion slot for asynchronous WebView2 construction.
    webview_result: Rc<RefCell<Option<anyhow::Result<WebView>>>>,
    /// Completion slot for the first top-level frontend navigation.
    navigation_result: Rc<RefCell<Option<anyhow::Result<()>>>>,
    /// Configured WebView2 wrapper after asynchronous construction succeeds.
    webview: Option<WebView>,
    /// Last client size applied to the WebView2 child controller.
    webview_size: PhysicalSize<u32>,
    /// Pure readiness state shared with deterministic unit tests.
    coordinator: StartupCoordinator,
    /// User-facing failure retained for splash rendering.
    failure: Option<StartupFailure>,
    /// Monotonic startup telemetry recorder.
    startup: StartupProbe,
    /// Event-loop proxy used by WebView2 completion callbacks.
    event_loop_proxy: EventLoopProxy<HostEvent>,
    /// Ensures controller and painter teardown is idempotent.
    shutdown: bool,
}

impl TurboDocHost {
    /// Create both top-level windows and begin hidden WebView2 construction.
    ///
    /// # Errors
    ///
    /// Returns an error when the splash renderer, workbench window, or native
    /// workbench handle cannot be initialized.
    fn new(
        event_loop: &ActiveEventLoop,
        event_loop_proxy: EventLoopProxy<HostEvent>,
        frontend: ActiveFrontend,
        server: Server,
        startup: StartupProbe)
     -> anyhow::Result<Self> {
        use nkcore::prelude::RawWindowHandleExt as _;
        use winit::platform::windows::BackdropType;
        use winit::platform::windows::WindowAttributesExtWindows as _;
        use winit::raw_window_handle::HasWindowHandle as _;

        let native_started_at = Instant::now();
        let splash = SplashSurface::new(event_loop, event_loop_proxy.clone())?;
        startup.mark("native startup surface shown");

        let workbench_window = Arc::new(event_loop.create_window(
            WindowAttributes::default()
                .with_title("TurboDoc")
                .with_inner_size(WORKBENCH_SIZE)
                .with_visible(false)
                .with_theme(Some(Theme::Dark))
                .with_system_backdrop(BackdropType::MainWindow)
                // WebView2 alpha-zero pixels reveal this parent HWND. Winit's
                // DWM transparency path makes that backing participate in the
                // system backdrop without turning the workbench into a wgpu surface.
                .with_transparent(true)
                .with_clip_children(true))
                .context("failed to create Mica workbench window")?);
        center_window(event_loop, &workbench_window);
        let hwnd = workbench_window
            .window_handle()
            .context("failed to get workbench window handle")?
            .as_raw()
            .as_hwnd();
        startup.mark_phase("winit windows and splash wgpu ready", native_started_at);

        let webview_result = Rc::new(RefCell::new(None));
        let result_slot = Rc::clone(&webview_result);
        let callback_proxy = event_loop_proxy.clone();
        let webview_started_at = Instant::now();
        let begin_webview_result = WebView::begin_create(hwnd, startup, move |result| {
            if result_slot.replace(Some(result)).is_some() {
                log::error!("WebView2 creation completed more than once");
            }
            callback_proxy.send_event(HostEvent::Wake).ok();
        });
        startup.mark_phase(
            "WebView2 asynchronous creation requested",
            webview_started_at);

        let mut host = Self {
            webview_size: workbench_window.inner_size(),
            workbench_window,
            splash,
            server: Some(server),
            coordinator: StartupCoordinator::new(frontend.kind),
            frontend,
            webview_result,
            navigation_result: Rc::new(RefCell::new(None)),
            webview: None,
            failure: None,
            startup,
            event_loop_proxy,
            shutdown: false,
        };
        if let Err(err) = begin_webview_result {
            host.fail("WebView2 could not be initialized.", err);
        }
        Ok(host)
    }

    /// Dispatch one nkcore event without exposing winit lifecycle plumbing.
    fn handle_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        event: nkcore::winit::AppEvent<HostEvent>) {
        match event {
            nkcore::winit::AppEvent::WindowEvent(window_id, event) => {
                if window_id == self.splash.window.id() {
                    self.splash.handle_window_event(
                        event_loop,
                        event,
                        self.coordinator.status,
                        self.failure.as_ref());
                } else if window_id == self.workbench_window.id() {
                    self.handle_workbench_event(event_loop, event);
                }
            },
            nkcore::winit::AppEvent::UserEvent(HostEvent::Wake) => {},
            nkcore::winit::AppEvent::UserEvent(HostEvent::RequestRepaint {
                when,
                cumulative_pass_nr,
            }) => self.splash.schedule_repaint(when, cumulative_pass_nr),
            nkcore::winit::AppEvent::UserEvent(HostEvent::AccessKit(event)) =>
                self.splash.handle_accesskit_event(event),
            nkcore::winit::AppEvent::DeviceEvent(_, _) => {},
            nkcore::winit::AppEvent::Idle => self.idle(event_loop),
            nkcore::winit::AppEvent::Exit => {
                log::debug!(
                    "native event loop exiting during {:?}",
                    self.coordinator.status);
                self.shutdown();
            },
        }
    }

    /// Handle workbench close and resize events without a wgpu integration.
    fn handle_workbench_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => {
                log::debug!(
                    "workbench close requested during {:?}",
                    self.coordinator.status);
                event_loop.exit();
            },
            WindowEvent::Resized(size) => self.resize_webview(size),
            _ => {},
        }
    }

    /// Advance startup, service repaint deadlines, and park the event loop.
    fn idle(&mut self, event_loop: &ActiveEventLoop) {
        self.poll_startup();
        let now = Instant::now();
        self.splash.flush_due_repaint(now);

        let navigation_deadline = if self.coordinator.status == StartupStatus::Navigating {
            self.coordinator.navigation_started_at
                .map(|started_at| started_at + INITIAL_NAVIGATION_TIMEOUT)
        } else {
            None
        };
        let deadline = [self.splash.repaint_deadline(), navigation_deadline]
            .into_iter()
            .flatten()
            .min();
        event_loop.set_control_flow(match deadline {
            Some(deadline) => ControlFlow::WaitUntil(deadline),
            None => ControlFlow::Wait,
        });
    }

    /// Advance all callback-driven startup paths without blocking winit.
    fn poll_startup(&mut self) {
        if self.coordinator.status == StartupStatus::Failed {
            return;
        }

        self.poll_dev_frontend();
        if matches!(
            self.coordinator.status,
            StartupStatus::Failed | StartupStatus::Ready)
        {
            return;
        }

        let webview_result = self.webview_result.borrow_mut().take();
        if let Some(result) = webview_result {
            match result {
                Ok(webview) => self.accept_webview(webview),
                Err(err) => self.fail("WebView2 could not be initialized.", err),
            }
        }
        if self.coordinator.status == StartupStatus::Failed {
            return;
        }

        let navigation_result = self.navigation_result.borrow_mut().take();
        if let Some(result) = navigation_result {
            match result {
                Ok(()) => {
                    self.coordinator.mark_ready();
                    self.apply_window_presentation();
                    self.startup.mark("Mica workbench shown; native splash hidden");
                },
                Err(err) => self.fail("TurboDoc could not load its frontend.", err),
            }
        }
        if matches!(
            self.coordinator.status,
            StartupStatus::Failed | StartupStatus::Ready)
        {
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
            let navigate_result = self.webview
                .as_ref()
                .expect("coordinator marked a missing WebView2 ready")
                .navigate(&self.frontend.url);
            match navigate_result {
                Ok(()) => self.startup.mark("initial navigation requested"),
                Err(err) => self.fail("TurboDoc could not begin navigation.", err),
            }
        }
    }

    /// Drain dev lifecycle events so queued exits win over new navigation.
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

    /// Configure a newly created WebView2 controller before navigation.
    fn accept_webview(&mut self, webview: WebView) {
        if let Err(err) = webview.set_bounds(webview_bounds(self.webview_size)) {
            self.fail("WebView2 could not be sized.", err);
            return;
        }

        if let Some(public_dir) = self.frontend.release_public_dir.as_deref()
            && let Err(err) = frontend::configure_release_frontend(&webview, public_dir)
        {
            self.fail("TurboDoc could not load its release frontend.", err);
            return;
        }

        let result_slot = Rc::clone(&self.navigation_result);
        let callback_proxy = self.event_loop_proxy.clone();
        let setup_result = webview_handlers::install(
            &self.workbench_window,
            &webview,
            &self.frontend.api_origin,
            self.frontend.kind,
            self.server.take().expect("WebView2 setup called twice"),
            self.startup,
            move |result| {
                if result_slot.replace(Some(result)).is_some() {
                    log::error!("initial navigation completed more than once");
                }
                callback_proxy.send_event(HostEvent::Wake).ok();
            });
        if let Err(err) = setup_result {
            self.fail("WebView2 event handlers could not be installed.", err);
            return;
        }

        self.webview = Some(webview);
        self.coordinator.mark_webview_ready();
        self.startup.mark("WebView2 wrapper ready");
    }

    /// Record an unrecoverable error and restore the native splash surface.
    fn fail(&mut self, summary: &'static str, error: anyhow::Error) {
        log::error!("{summary} {error:#}");
        if let Some(webview) = &self.webview
            && let Err(err) = webview.set_visible(false)
        {
            log::error!("failed to hide WebView2 after startup failure: {err:#}");
        }
        self.failure = Some(StartupFailure::new(
            summary,
            format!("{error:#}")));
        self.coordinator.mark_failed();
        self.apply_window_presentation();
    }

    /// Apply the visibility policy after a terminal startup transition.
    fn apply_window_presentation(&mut self) {
        let presentation = window_presentation(self.coordinator.status);
        log::debug!(
            "applying {:?} presentation: splash {:?} visible={}, workbench {:?} visible={}",
            self.coordinator.status,
            self.splash.window.id(),
            presentation.splash_visible,
            self.workbench_window.id(),
            presentation.workbench_visible);
        self.workbench_window
            .set_visible(presentation.workbench_visible);
        self.splash.set_visible(presentation.splash_visible);
        if presentation.workbench_visible {
            self.workbench_window.focus_window();
        } else if presentation.splash_visible {
            self.splash.window.focus_window();
        }
    }

    /// Keep the WebView2 child controller aligned with workbench client area.
    fn resize_webview(&mut self, size: PhysicalSize<u32>) {
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

    /// Close any completed controller and release renderer state exactly once.
    fn shutdown(&mut self) {
        if self.shutdown {
            return;
        }
        self.shutdown = true;
        let pending_webview = self.webview_result
            .borrow_mut()
            .take()
            .and_then(Result::ok);
        let webview = self.webview.take().or(pending_webview);
        if let Some(webview) = webview
            && let Err(err) = webview.close()
        {
            log::error!("failed to close WebView2 during host shutdown: {err:#}");
        }
        self.splash.destroy();
    }
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
