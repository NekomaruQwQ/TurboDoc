use windows::Win32::Foundation::HWND;
use winit::window::Window;

pub fn run() {
    #![expect(deprecated, reason = "using winit without the trait-based API")]

    use std::cell::*;
    use std::rc::Rc;

    use windows::Win32::Foundation::*;

    use winit::{
        dpi::LogicalSize,
        event::Event,
        event::WindowEvent,
        event_loop::EventLoop,
        window::Window,
    };

    use crate::common::*;
    use crate::consts::*;
    use crate::server::WebServer;
    use crate::webview::WebView;

    let cache_dir = EXECUTABLE_DIR.join("turbodoc.exe.WebCache");
    let server = RefCell::new(WebServer::new(&cache_dir));
    log::info!("cache directory: {}", cache_dir.display());

    log::info!("creating main window...");
    let event_loop = EventLoop::new().unwrap();
    let window =
        event_loop
            .create_window(
                Window::default_attributes()
                    .with_title("TurboDoc")
                    .with_inner_size(LogicalSize::<u32>::new(1440, 900))
                    .with_visible(false /* show window after page loaded */))
            .unwrap();
    let window = Rc::new(window);
    let window_handle = get_window_handle(&window);

    log::info!("creating WebView2...");
    let webview = Rc::new(WebView::new(window_handle).unwrap());

    log::info!("configuring WebView2...");
    webview.on_next_navigation_completed({
        let window = Rc::clone(&window);
        let webview = Rc::clone(&webview);
        move |result| match result {
            Ok(()) => {
                window.set_visible(true);
                let _ =
                    webview
                        .set_visible(true)
                        .inspect_err(|err| log::error!("{err}"));
                log::info!("showing main window...");
            },
            Err(err) =>
                panic!("navigation failed with status {err:?}"),
        }
    }).unwrap();

    webview.on_web_resource_requested(
        move |request| {
            use http::Method;
            if request.method() == Method::GET && KNOWN_URL.contains(&request.uri().to_string()) {
                Some(server.borrow_mut().handle_request(request))
            } else {
                log::info!("(direct) {} {}", request.method(), request.uri());
                None
            }
        }).unwrap();

    webview.on_frame_navigation_starting({
        let window = Rc::clone(&window);
        move |url, cancel_navigation| {
            log::info!("navigating to {url}");
            if !KNOWN_URL.contains(url) {
                log::info!(" -> external link, navigation cancelled");
                cancel_navigation();
                open_external_link(&window, url);
            }
        }
    }).unwrap();

    log::info!("loading frontend...");
    webview.navigate(FRONTEND_URL).unwrap();

    event_loop.run(move |event, event_loop| {
        if let Event::WindowEvent { event, window_id } = event {
            if window_id == window.id() {
                match event {
                    WindowEvent::CloseRequested =>
                        event_loop.exit(),
                    WindowEvent::Resized(size) => {
                        let _ = webview
                            .set_bounds(RECT {
                                left: 0,
                                top: 0,
                                right: size.width as _,
                                bottom: size.height as _,
                            })
                            .inspect_err(|err| log::error!("{err}"));
                    },
                    _ => {},
                }
            } else {
                log::warn!("ignoring event for unknown window {window_id:?}: {event:?}");
            }
        }
    }).unwrap();
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
        panic!("failed to get Win32 window handle");
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
