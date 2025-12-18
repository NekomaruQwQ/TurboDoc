use nkcore::*;

use std::rc::Rc;

use windows::Win32::Foundation::*;
use winit::window::Window;

use crate::consts::*;
use crate::server::WebServer;
use crate::webview::WebView;
use crate::webview::WebViewNavigationResult;

pub fn run() -> anyhow::Result<()> {
    #![expect(deprecated, reason = "using winit without the trait-based API")]

    use winit::{
        dpi::LogicalSize,
        event::Event,
        event::WindowEvent,
        event_loop::EventLoop,
        window::Window,
    };

    log::info!("cache directory: {}", CACHE_DIR.display());
    log::info!("frontend url: {FRONTEND_URL}...");

    let event_loop =
        api_call!(EventLoop::<()>::new())?;
    let window =
        api_call! {
            event_loop.create_window(
                Window::default_attributes()
                    .with_title("TurboDoc")
                    .with_inner_size(LogicalSize::<u32>::new(1440, 900))
                    .with_visible(false /* show window after page loaded */))
        }?;
    let window = Rc::new(window);
    let webview =
        WebView::new(get_window_handle(&window))
            .context("failed to create webview")?;
    handler::setup(&window, &webview)
        .context("failed to setup webview event handlers")?;
    webview.navigate(FRONTEND_URL)
        .context("failed to load frontend")?;

    event_loop.run(move |event, event_loop| {
        if let Event::WindowEvent { event, window_id } = event {
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
    }).context("failed to run event loop")?;

    Ok(())
}

fn get_window_handle(window: &Window) -> HWND {
    use winit::raw_window_handle::{
        HasWindowHandle as _,
        RawWindowHandle,
    };

    if let Ok(RawWindowHandle::Win32(handle)) =
        window
            .window_handle()
            .map(|handle| handle.as_raw()) {
        HWND(handle.hwnd.get() as _)
    } else {
        panic!("unexpected platform: only Win32 is supported");
    }
}

fn open_external_link(window: &Window, url: &str) {
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
    use super::*;

    pub fn setup(window: &Rc<Window>, webview: &WebView) -> anyhow::Result<()> {
        webview.on_next_navigation_completed({
            let window = Rc::clone(window);
            let webview = webview.clone();
            move |result| on_first_navigation_completed(&window, &webview, result)
        })?;

        webview.on_web_resource_requested({
            let mut server = WebServer::new(CACHE_DIR.as_path());
            move |request| on_web_resource_requested(&mut server, request)
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

        webview.on_web_message_received({
            let webview = webview.clone();
            let data_dir = DATA_DIR.clone();
            move |message_str| {
                on_web_message_received(
                    &webview,
                    data_dir.as_path(),
                    message_str);
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

    fn on_web_resource_requested(
        server: &mut WebServer,
        request: WebRequest)
     -> Option<WebResponse> {
        use http::Method;
        if request.method() == Method::GET && KNOWN_URL.contains(&request.uri().to_string()) {
            Some(server.handle_request(request))
        } else {
            log::info!("(direct) {} {}", request.method(), request.uri());
            None
        }
    }

    fn on_frame_navigation_starting(
        window: &Window,
        webview: &WebView,
        url: &str,
        cancel_navigation: Box<dyn FnOnce()>) {
        log::info!("navigating to {url}");
        if !KNOWN_URL.contains(url) {
            log::info!(" -> external link, navigation cancelled");
            cancel_navigation();
            open_external_link(window, url);
        } else {
            // Notify frontend of navigation
            let message = serde_json::json!({
                "type": "navigated",
                "url": url,
            }).to_string();
            let _ = webview.post_message_as_json(&message)
                .inspect_err(|err| log::error!("failed to send navigated: {err}"));
        }
    }

    fn on_web_message_received(
        webview: &WebView,
        data_dir: &std::path::Path,
        message_str: &str) {
        // Parse simple JSON messages
        let message: serde_json::Value = match serde_json::from_str(message_str) {
            Ok(msg) => msg,
            Err(err) => {
                log::error!("failed to parse IPC message: {err}");
                return;
            }
        };

        let Some(msg_type) = message.get("type").and_then(|v| v.as_str()) else {
            log::error!("message missing 'type' field");
            return;
        };

        match msg_type {
            "load-workspace" => {
                let response = load_workspace(data_dir);
                let _ = webview.post_message_as_json(&response)
                    .inspect_err(|err| log::error!("failed to send response: {err}"));
            },
            "save-workspace" => {
                if let Some(content) = message.get("content").and_then(|v| v.as_str()) {
                    let response = save_workspace(data_dir, content);
                    let _ = webview.post_message_as_json(&response)
                        .inspect_err(|err| log::error!("failed to send response: {err}"));
                } else {
                    log::error!("save_file message missing 'content' field");
                }
            },
            _ => {
                log::warn!("unknown message type: {msg_type}");
            }
        }
    }

    /// Load workspace file as raw string and return JSON response.
    /// Returns null content if file doesn't exist (not an error).
    fn load_workspace(data_dir: &std::path::Path) -> String {
        let path = data_dir.join("workspace.json");

        match std::fs::read_to_string(&path) {
            Ok(content) => serde_json::json!({
            "type": "workspace-loaded",
            "success": true,
            "content": content,
        }).to_string(),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                serde_json::json!({
                "type": "workspace-loaded",
                "success": true,
                "content": "{}",
            }).to_string()
            },
            Err(err) => serde_json::json!({
                "type": "workspace-loaded",
                "success": false,
                "message": format!("{err:?}"),
            }).to_string(),
        }
    }

    /// Save workspace file from raw string and return JSON response.
    fn save_workspace(data_dir: &std::path::Path, content: &str) -> String {
        let path = data_dir.join("workspace.json");

        // Create directory if needed
        if let Err(err) = std::fs::create_dir_all(data_dir) {
            return serde_json::json!({
            "type": "workspace-saved",
            "success": false,
            "message": format!("{err:?}"),
        }).to_string();
        }

        match std::fs::write(&path, content) {
            Ok(()) => serde_json::json!({
                "type": "workspace-saved",
                "success": true,
            }).to_string(),
            Err(err) => serde_json::json!({
                "type": "workspace-saved",
                "success": false,
                "message": format!("{err:?}"),
            }).to_string(),
        }
    }
}
