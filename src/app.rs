use nkcore::prelude::*;
use nkcore::debug::*;

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

        webview.on_web_message_received({
            let webview = webview.clone();
            move |message| on_web_message_received(&webview, message)
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
        } else if !IGNORED_URL.contains(url) {
            // Notify frontend of navigation
            let message = serde_json::json!({
                "type": "navigated",
                "url": url,
            }).to_string();
            let _ = webview.post_message_as_json(&message)
                .inspect_err(|err| log::error!("failed to send navigated: {err}"));
        } else {
            log::info!(" -> ignored link, navigation cancelled");
        }
    }

    fn on_web_message_received(webview: &WebView, message: &str) {
        let result =
            ipc::handle_request(message)
                .map(|response| response.to_string())
                .and_then(|response| webview.post_message_as_json(&response));
        if let Err(err) = result {
            log::error!("{err}");
        }
    }
}

mod ipc {
    use nkcore::prelude::*;
    use nkcore::debug::*;

    use crate::prelude::*;
    use crate::consts::*;

    use std::fs;
    use std::path::Path;

    pub fn handle_request(message: &str) -> anyhow::Result<JsonValue> {
        let Ok((message_type, message)) = parse_ipc_message(message) else {
            log::error!("failed to parse ipc message: {message}");
            anyhow::bail!("failed to parse ipc message: {message}");
        };

        Ok(match message_type.as_str() {
            "load-workspace" =>
                load_workspace(),
            "save-workspace" => {
                let content =
                    message
                        .get("content")
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                save_workspace(content)
            },
            "load-cache" =>
                load_cache(),
            "save-cache" => {
                let content =
                    message
                        .get("content")
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                save_cache(content)
            },
            _ => {
                log::error!("unknown ipc message type '{message_type}'");
                anyhow::bail!("unknown ipc message type '{message_type}'");
            }
        })
    }

    fn parse_ipc_message(message: &str) -> anyhow::Result<(String, JsonValue)> {
        let message =
            serde_json::from_str::<JsonValue>(message)
                .context("ipc message is not valid json")?;
        let message_type =
            message
                .get("type")
                .and_then(|value| value.as_str())
                .ok_or_else(|| anyhow::anyhow!("ipc message is missing 'type' field"))?
                .to_owned();
        Ok((message_type, message))
    }

    fn load_workspace() -> JsonValue {
        let file_path = DATA_DIR.join("workspace.json");
        match load_file(&file_path) {
            Ok(Some(content)) => {
                log::info!("workspace loaded.");
                serde_json::json!({
                    "type": "workspace-loaded",
                    "success": true,
                    "content": content,
                })
            },
            Ok(None) => {
                // Workspace file not present is not an error. We just create an empty workspace
                // and return that.
                log::info!("workspace not found. an empty workspace will be created.");
                serde_json::json!({
                    "type": "workspace-loaded",
                    "success": true,
                    "content": "{}",
                })
            },
            Err(err) =>{
                // Failing to load workspace is fatal. To avoid overwriting existing data,
                // we propagate the error instead of creating a new empty workspace.
                log::error!("failed to load workspace {}: {err:?}", file_path.display());
                serde_json::json!({
                    "type": "workspace-loaded",
                    "success": false,
                    "message": format!("{err:?}"),
                })
            },
        }
    }

    fn save_workspace(content: &str) -> JsonValue {
        let file_path = DATA_DIR.join("workspace.json");
        match save_file(&file_path, content) {
            Ok(()) =>{
                log::info!("workspace saved.");
                serde_json::json!({
                    "type": "workspace-saved",
                    "success": true,
                })
            },
            Err(err) => {
                log::error!("failed to save workspace {}: {err:?}", file_path.display());
                serde_json::json!({
                    "type": "workspace-saved",
                    "success": false,
                    "message": format!("{err:?}"),
                })
            }
        }
    }

    fn load_cache() -> JsonValue {
        let file_path = DATA_DIR.join("cache.json");
        let file_content = match load_file(&file_path) {
            Ok(Some(content)) => {
                log::info!("frontend cache loaded.");
                Some(content)
            },
            Ok(None) => {
                log::info!("frontend cache not found.");
                log::info!("frontend cache will be created on the next fetch.");
                None
            },
            Err(err) => {
                // Failing to load frontend cache is non-fatal, so we just log error
                // and return an empty cache.
                log::warn!("failed to load frontend cache: {err}");
                log::warn!("frontend cache will be created on the next fetch.");
                None
            }
        };

        serde_json::json!({
            "type": "cache-loaded",
            "success": true,
            "content":
                file_content
                    .as_deref()
                    .unwrap_or("{}"),
        })
    }

    fn save_cache(content: &str) -> JsonValue {
        let file_path = DATA_DIR.join("cache.json");
        match save_file(&file_path, content) {
            Ok(()) =>{
                log::info!("frontend cache saved.");
                serde_json::json!({
                    "type": "cache-saved",
                    "success": true,
                })
            },
            Err(err) => {
                log::error!("failed to save frontend cache {}: {err:?}", file_path.display());
                serde_json::json!({
                    "type": "cache-saved",
                    "success": false,
                    "message": format!("{err:?}"),
                })
            }
        }
    }

    /// Load file content as [`String`].
    ///
    /// Returns `Ok(None)` if file doesn't exist (not an error).
    /// Returns `Err` on other IO errors.
    fn load_file(path: &Path) -> anyhow::Result<Option<String>> {
        match fs::read_to_string(path) {
            Ok(content) =>
                Ok(Some(content)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound =>
                Ok(None),
            Err(err) =>
                Err(anyhow::anyhow!("failed to read file {}: {err:?}", path.display())),
        }
    }

    fn save_file(path: &Path, content: &str) -> anyhow::Result<()> {
        // Create containing directory if needed
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| context!("failed to create directory {}", parent.display()))?;
        }

        fs::write(path, content)
            .with_context(|| context!("failed to write file {}", path.display()))
    }
}
