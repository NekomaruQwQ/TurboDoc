use std::cell::{Cell, LazyCell};
use std::rc::Rc;
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

    log::info!("creating WebView2 components...");
    let webview = Rc::new(WebView::new(window_handle));

    invoke_with_lazy_result::<Box<dyn Fn()>, _>(|remove_handler_callback| {
        webview.on_navigation_completed({
            let window = Rc::clone(&window);
            let webview = Rc::clone(&webview);
            move || {
                LazyCell::force(&remove_handler_callback)();
                window.set_visible(true);
                webview.set_visible(true);
                log::info!("showing main window...");
            }
        })
    });

    let _ = webview.on_web_resource_requested(move |request| {
        use http::Method;
        if
        request.method() == Method::GET &&
            KNOWN_URL.iter().any(|&known| request.uri().to_string().starts_with(known)) {
            Some(server.borrow_mut().handle_request(request))
        } else {
            log::info!("(direct) {} {}", request.method(), request.uri());
            None
        }
    });

    let _ = webview.on_frame_navigation_starting(|url, cancel_navigation| {
        log::info!("navigating to {url}");
        if !KNOWN_URL.iter().any(|&known| url.starts_with(known)) {
            log::info!(" -> external URL, cancelling navigation");
            cancel_navigation();
        }
    });

    log::info!("loading frontend...");
    webview.navigate(FRONTEND_URL).unwrap();

    event_loop.run(move |event, event_loop| {
        if let Event::WindowEvent { event, window_id } = event {
            if window_id == window.id() {
                match event {
                    WindowEvent::CloseRequested =>
                        event_loop.exit(),
                    WindowEvent::Resized(size) => {
                        let result = unsafe {
                            webview.controller.SetBounds(RECT {
                                left: 0,
                                top: 0,
                                right: size.width as _,
                                bottom: size.height as _,
                            })
                        };

                        if let Err(err) = result {
                            log::error!("ICoreWebView2Controller::SetBounds failed: {err:?}");
                        }
                    },
                    _ => {},
                }
            } else {
                log::warn!("received event for unknown window: {window_id:?}");
            }
        }
    }).unwrap();
}


/// Invokes a function that lazily consumes its return value.
fn invoke_with_lazy_result<T: 'static, F>(f: F)
where
    F: Sized + FnOnce(LazyCell<T, Box<dyn Fn() -> T>>) -> T, {
    let cell = Rc::new(Cell::new(None));
    let cell_clone = Rc::clone(&cell);
    cell.set(Some(f(LazyCell::new(Box::new(move || {
        cell_clone
            .take()
            .expect("Cell not set or already taken")
    })))));
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
