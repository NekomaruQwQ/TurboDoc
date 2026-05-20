use nkcore::prelude::*;
use nkcore::debug::*;

use crate::server::Server;

pub fn run(url: &str, server: Server) {
    use nkcore::os::windows::{
        prelude::RawWindowHandleExt as _,
        winit::EventLoopExt as _,
        winit::AppEvent,
    };

    use crate::webview::WebView;

    use std::rc::Rc;
    use windows::Win32::Foundation::RECT;
    use winit::{
        dpi::LogicalSize,
        event::WindowEvent,
        event_loop::EventLoop,
        raw_window_handle::HasWindowHandle as _,
        window::Window,
    };

    // `EventLoop::run_app_with`'s setup closure is `FnOnce`, but the wrapper
    // around it isn't reflected in the type. Move the handle into an Option
    // so we can take it inside the closure without the borrow checker losing
    // its mind over a `FnMut` capture.
    let mut server = Some(server);

    EventLoop::<()>::new()
        .expect("failed to create event loop")
        .run_app_with(|event_loop| {
            let window =
                api_call! {
                    event_loop.create_window(
                        Window::default_attributes()
                            .with_title("TurboDoc")
                            .with_inner_size(LogicalSize::<u32>::new(1280, 800))
                            .with_visible(false /* show window after page loaded */))
                }.expect("failed to create window");
            let window = Rc::new(window);
            let webview =
                WebView::new(window.window_handle().unwrap().as_raw().as_hwnd())
                    .expect("failed to create webview");
            handler::setup(&window, &webview, server.take().expect("setup called twice"))
                .expect("failed to setup webview event handlers");
            webview.navigate(url)
                .expect("failed to load frontend");

            move |event_loop, event| {
                if let AppEvent::WindowEvent(window_id, event) = event {
                    if window_id == window.id() {
                        match event {
                            WindowEvent::CloseRequested =>
                                event_loop.exit(),
                            WindowEvent::Resized(size) => {
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
                }
            }
        })
        .expect("failed to run event loop");
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
            use nkcore::os::windows::prelude::RawWindowHandleExt as _;
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
    use crate::webview::WebView;
    use crate::webview::WebViewNavigationResult;

    use std::rc::Rc;
    use winit::window::Window;

    pub fn setup(
        window: &Rc<Window>,
        webview: &WebView,
        server: Server)
     -> anyhow::Result<()> {
        webview.on_next_navigation_completed({
            let window = Rc::clone(window);
            let webview = webview.clone();
            move |result| on_first_navigation_completed(&window, &webview, result)
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
        window: &Window,
        webview: &WebView,
        result: WebViewNavigationResult) {
        match result {
            Ok(()) => {
                window.set_visible(true);
                let _ =
                    webview
                        .set_visible(true)
                        .inspect_err(|err| log::error!("{err}"));
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
            return match server.fetch(&uri) {
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
