mod core {
    use std::env;
    use std::path::PathBuf;
    use std::sync::LazyLock;

    pub type WebRequest = http::Request<Vec<u8>>;
    pub type WebResponse = http::Response<Vec<u8>>;
    pub use http::request::Builder as WebRequestBuilder;
    pub use http::response::Builder as WebResponseBuilder;

    pub fn default<T: Default>() -> T { T::default() }

    pub static EXECUTABLE_DIR: LazyLock<PathBuf> = LazyLock::new(|| {
        env::current_exe()
            .unwrap_or_else(|err| panic!("failed to get executable path: {err}"))
            .parent()
            .expect("failed to get executable path: missing parent directory")
            .to_owned()
    });
}

mod consts {
    use std::time::Duration;

    pub const CACHE_EXPIRY: Duration = Duration::from_secs(60 * 60 * 24); // 1 day
    pub const FRONTEND_URL: &str = "http://localhost:9680/";

    pub const KNOWN_URL: &[&str] = &[
        "https://docs.rs",
    ];
}

mod server;
mod ipc;
mod webview;

fn main() {
    #![expect(deprecated, reason = "using winit without the trait-based API")]

    use std::cell::*;
    use std::rc::Rc;

    use windows::Win32::Foundation::*;

    use winit::{
        dpi::LogicalSize,
        event::Event,
        event::WindowEvent,
        event_loop::EventLoop,
        raw_window_handle::HasWindowHandle as _,
        raw_window_handle::RawWindowHandle,
        window::Window,
    };

    use crate::core::*;
    use crate::consts::*;
    use crate::server::WebServer;
    use crate::webview::WebView;

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

    pretty_env_logger::init();

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
    let hwnd =
        if let Ok(RawWindowHandle::Win32(handle)) =
            window
                .window_handle()
                .map(|handle| handle.as_raw()) {
            HWND(handle.hwnd.get() as _)
        } else {
            panic!("failed to get Win32 window handle");
        };

    log::info!("creating WebView2 components...");
    let webview = Rc::new(WebView::new(hwnd));

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
        if request.uri().to_string().starts_with(FRONTEND_URL) {
            None?;
        }

        Some(server.borrow_mut().handle_request(request))
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


// let server = RefCell::new(WebProxy::new());
//
// let _webview = wry::WebViewBuilder::new()
//     .with_url(FRONTEND_URL)
//     .with_custom_protocol("app".into(), move |_, request| {
//         server
//             .borrow_mut()
//             .handle_request(request)
//     })
//     .with_ipc_handler(|request| {
//         handle_ipc(toml::from_str(request.body()).unwrap());
//     })
//     .with_on_page_load_handler({
//         let window = Rc::clone(&window);
//         move |event, _| if matches!(event, wry::PageLoadEvent::Finished) {
//             window.set_visible(true);
//         }
//     })
//     .build(&window)
//     .expect("failed to create webview");
//
// event_loop.run(move |event, event_loop| {
//     if let Event::WindowEvent { event, window_id } = event {
//         if window_id == window.id() {
//             if matches!(event, WindowEvent::CloseRequested) {
//                 event_loop.exit();
//             }
//         } else {
//             log::warn!("received event for unknown window: {window_id:?}");
//         }
//     }
// }).unwrap();
