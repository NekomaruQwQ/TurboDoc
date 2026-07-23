use nkcore::prelude::*;
use nkcore::debug::*;

use crate::server::FrontendConfig;
use crate::server::Server;
use crate::startup::StartupProbe;

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

/// Run the native host while Vite and WebView2 initialize concurrently.
///
/// The native window is shown as soon as its workbench-colored client area
/// is painted. Initial navigation remains gated on Vite's readiness event,
/// and the WebView2 controller remains hidden until navigation completes.
pub fn run(
    url: String,
    server: Server,
    frontend_config: FrontendConfig,
    startup: StartupProbe) {
    use nkcore::{
        prelude::RawWindowHandleExt as _,
        winit::EventLoopExt as _,
        winit::AppEvent,
    };

    use crate::webview::WebView;

    use std::rc::Rc;
    use std::time::Instant;
    use windows::Win32::Foundation::RECT;
    use winit::{
        dpi::LogicalSize,
        event::WindowEvent,
        event_loop::EventLoop,
        platform::windows::Color,
        platform::windows::WindowAttributesExtWindows as _,
        raw_window_handle::HasWindowHandle as _,
        window::Theme,
        window::Window,
    };

    /// Cross-thread startup result delivered from Tokio to the UI loop.
    enum StartupEvent {
        FrontendReady(anyhow::Result<()>),
    }

    let event_loop_started_at = Instant::now();
    let mut event_loop =
        EventLoop::<StartupEvent>::with_user_event()
            .build()
            .expect("failed to create event loop");
    startup.mark_phase("winit event loop ready", event_loop_started_at);

    // Vite starts on Tokio immediately. Its event may queue while WebView2
    // creation blocks, but winit dispatches it only after setup returns.
    let event_proxy = event_loop.create_proxy();
    server.spawn_frontend(frontend_config, startup, move |result| {
        if event_proxy
            .send_event(StartupEvent::FrontendReady(result))
            .is_err()
        {
            log::debug!("discarding Vite readiness after event-loop shutdown");
        }
    });

    // `EventLoop::run_app_with`'s setup closure is `FnOnce`, but the wrapper
    // around it isn't reflected in the type. Move the handle into an Option
    // so we can take it inside the closure without the borrow checker losing
    // its mind over a `FnMut` capture.
    let mut server = Some(server);

    event_loop
        .run_app_with(move |event_loop| {
            let window_started_at = Instant::now();
            let window =
                api_call! {
                    event_loop.create_window(
                        Window::default_attributes()
                            .with_title("TurboDoc")
                            .with_inner_size(LogicalSize::<u32>::new(1280, 800))
                            .with_theme(Some(Theme::Dark))
                            .with_title_background_color(Some(Color::from_rgb(
                                crate::startup::STARTUP_BACKGROUND.red,
                                crate::startup::STARTUP_BACKGROUND.green,
                                crate::startup::STARTUP_BACKGROUND.blue)))
                            .with_visible(false))
                }.expect("failed to create window");
            startup.mark_phase("native window created", window_started_at);

            let window = Rc::new(window);
            let hwnd =
                window
                    .window_handle()
                    .expect("failed to get native window handle")
                    .as_raw()
                    .as_hwnd();
            paint_startup_background(hwnd)
                .expect("failed to paint native startup background");
            window.set_visible(true);
            window.request_redraw();
            startup.mark("native window shown");

            let webview_started_at = Instant::now();
            let webview =
                WebView::new(hwnd, startup)
                    .expect("failed to create webview");
            startup.mark_phase("WebView2 wrapper ready", webview_started_at);

            let initial_size = window.inner_size();
            webview
                .set_bounds(RECT {
                    left: 0,
                    top: 0,
                    right: initial_size.width as _,
                    bottom: initial_size.height as _,
                })
                .expect("failed to set initial WebView2 bounds");
            handler::setup(
                &window,
                &webview,
                &url,
                server.take().expect("setup called twice"),
                startup)
                .expect("failed to setup webview event handlers");
            startup.mark("native and WebView2 initialization ready");

            let mut initial_navigation_started = false;

            move |event_loop, event| {
                match event {
                    AppEvent::UserEvent(StartupEvent::FrontendReady(result)) => {
                        result.expect("failed to start Vite frontend");
                        assert!(
                            !initial_navigation_started,
                            "Vite readiness delivered multiple times");
                        initial_navigation_started = true;
                        startup.mark("Vite and WebView2 synchronized");
                        webview
                            .navigate(&url)
                            .expect("failed to load frontend");
                        startup.mark("initial navigation requested");
                    },
                    AppEvent::WindowEvent(window_id, event) => {
                        if window_id == window.id() {
                            match event {
                                WindowEvent::CloseRequested =>
                                    event_loop.exit(),
                                WindowEvent::RedrawRequested => {
                                    if let Err(err) = paint_startup_background(hwnd) {
                                        log::error!("failed to repaint native background: {err}");
                                    }
                                },
                                WindowEvent::Resized(size) => {
                                    if let Err(err) = paint_startup_background(hwnd) {
                                        log::error!("failed to repaint resized background: {err}");
                                    }
                                    let new_bounds = RECT {
                                        left: 0,
                                        top: 0,
                                        right: size.width as _,
                                        bottom: size.height as _,
                                    };

                                    if let Err(err) = webview.set_bounds(new_bounds) {
                                        log::error!("failed to resize webview: {err}");
                                    }
                                },
                                _ => {},
                            }
                        } else {
                            log::warn!("ignoring event for unknown window {window_id:?}: {event:?}");
                        }
                    },
                    _ => {},
                }
            }
        })
        .expect("failed to run event loop");
}

/// Paint the winit client area with the frontend's workbench color before the
/// WebView2 child is visible. The DC and brush are always released, including
/// when the fill fails.
fn paint_startup_background(hwnd: windows::Win32::Foundation::HWND) -> anyhow::Result<()> {
    use windows::core::Owned;
    use windows::Win32::Foundation::COLORREF;
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::CreateSolidBrush;
    use windows::Win32::Graphics::Gdi::FillRect;
    use windows::Win32::Graphics::Gdi::GetDC;
    use windows::Win32::Graphics::Gdi::ReleaseDC;
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

    let device_context = unsafe { GetDC(Some(hwnd)) };
    if device_context.is_invalid() {
        anyhow::bail!("GetDC returned an invalid device context");
    }

    let result = (|| {
        let mut client_rect = RECT::default();
        unsafe { GetClientRect(hwnd, &raw mut client_rect) }
            .context("GetClientRect failed")?;

        let color = crate::startup::STARTUP_BACKGROUND;
        let color_ref =
            COLORREF(
                u32::from(color.red) |
                u32::from(color.green) << 8 |
                u32::from(color.blue) << 16);
        let brush_handle = unsafe { CreateSolidBrush(color_ref) };
        if brush_handle.is_invalid() {
            anyhow::bail!("CreateSolidBrush returned an invalid brush");
        }

        // SAFETY: CreateSolidBrush transfers ownership of this brush to the
        // caller; Owned releases it through DeleteObject after FillRect.
        let brush = unsafe { Owned::new(brush_handle) };
        if unsafe { FillRect(device_context, &raw const client_rect, *brush) } == 0 {
            anyhow::bail!("FillRect failed");
        }
        Ok(())
    })();

    if unsafe { ReleaseDC(Some(hwnd), device_context) } == 0 {
        if result.is_ok() {
            anyhow::bail!("ReleaseDC failed");
        }
        log::warn!("ReleaseDC failed while unwinding a startup paint error");
    }

    result
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

    use std::rc::Rc;
    use winit::window::Window;

    pub fn setup(
        window: &Rc<Window>,
        webview: &WebView,
        frontend_url: &str,
        server: Server,
        startup: StartupProbe)
     -> anyhow::Result<()> {
        for uri_pattern in super::web_resource_request_filters(frontend_url) {
            webview.add_web_resource_requested_filter(&uri_pattern)?;
        }

        webview.on_next_navigation_completed({
            let webview = webview.clone();
            move |result| on_first_navigation_completed(&webview, startup, result)
        })?;

        webview.on_web_resource_requested(move |request| on_web_resource_requested(&server, request))?;

        webview.on_frame_navigation_starting({
            let window = Rc::clone(window);
            let webview = webview.clone();
            move |url, cancel_navigation| {
                on_frame_navigation_starting(
                    &window,
                    &webview,
                    url,
                    cancel_navigation);
            }
        })?;

        Ok(())
    }

    fn on_first_navigation_completed(
        webview: &WebView,
        startup: StartupProbe,
        result: WebViewNavigationResult) {
        match result {
            Ok(()) => {
                webview
                    .set_visible(true)
                    .expect("failed to show WebView2 controller");
                startup.mark("initial navigation completed; WebView2 shown");
            },
            Err(err) =>
                panic!("failed to load frontend with status {err:?}"),
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
    /// - External URLs: cancel navigation and offer to open in the system browser.
    fn on_frame_navigation_starting(
        window: &Window,
        webview: &WebView,
        url: &str,
        cancel_navigation: Box<dyn FnOnce()>) {
        log::info!("navigating to {url}");
        if crate::HOSTED_URL.iter().any(|&prefix| url.starts_with(prefix)) {
            // Notify frontend of navigation so it can update the sidebar.
            let message = serde_json::json!({
                "type": "navigated",
                "url": url,
            }).to_string();
            let _ = webview.post_message_as_json(&message)
                .inspect_err(|err| log::error!("failed to send navigated: {err}"));
        } else {
            log::info!(" -> external link, navigation cancelled");
            cancel_navigation();
            super::open_external_link(window, url);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::web_resource_request_filters;

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
