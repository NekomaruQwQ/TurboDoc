use nkcore::prelude::*;
use nkcore::debug::*;

pub fn run(url: &str) {
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
            handler::setup(&window, &webview, url)
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
            use std::process::Command;
            let _ = Command::new("cmd")
                .args(["/C", "start", "", url])
                .spawn()
                .inspect_err(|err| log::error!("failed to open external link: {err}"));
        },
        Ok(false) => {},
        Err(err) => {
            log::error!("failed to show dialog: {err}");
        }
    }
}

mod handler {
    use crate::prelude::*;
    use crate::webview::WebView;
    use crate::webview::WebViewNavigationResult;

    use std::rc::Rc;
    use winit::window::Window;

    pub fn setup(
        window: &Rc<Window>,
        webview: &WebView,
        server_url: &str)
     -> anyhow::Result<()> {
        webview.on_next_navigation_completed({
            let window = Rc::clone(window);
            let webview = webview.clone();
            move |result| on_first_navigation_completed(&window, &webview, result)
        })?;

        webview.on_web_resource_requested({
            // Proxy client with auto-redirect disabled, matching the WinUI app's behavior.
            // Redirects pass through to WebView2 which re-navigates and re-triggers interception.
            let client = reqwest::blocking::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("failed to create HTTP client");
            let server_url = server_url.to_owned();
            move |request| on_web_resource_requested(&client, &server_url, request)
        })?;

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

    /// Proxies GET requests for known doc URLs through the server's `/proxy?url=` endpoint.
    fn on_web_resource_requested(
        client: &reqwest::blocking::Client,
        server_url: &str,
        request: WebRequest)
     -> Option<WebResponse> {
        use http::Method;
        let uri = request.uri().to_string();
        if request.method() != Method::GET ||
            !crate::PROXIED_URL.iter().any(|&prefix| uri.starts_with(prefix)) {
            return None;
        }

        match client.get(format!("{server_url}/proxy")).query(&[("url", &uri)]).send() {
            Ok(response) =>
                Some(convert_proxy_response(response)),
            Err(err) => {
                log::error!("proxy request failed for {uri}: {err}");
                None
            }
        }
    }

    /// Converts a [`reqwest::blocking::Response`] into a [`WebResponse`] for WebView2.
    fn convert_proxy_response(response: reqwest::blocking::Response) -> WebResponse {
        let status = response.status().as_u16();
        let headers: Vec<_> = response.headers()
            .iter()
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect();
        let body = response.bytes()
            .inspect_err(|err| log::error!("failed to read proxy response body: {err}"))
            .unwrap_or_default()
            .to_vec();

        let mut builder = http::Response::builder().status(status);
        for (name, value) in headers {
            builder = builder.header(name, value);
        }
        builder.body(body).unwrap()
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
