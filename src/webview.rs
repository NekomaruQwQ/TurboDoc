use anyhow::Context as _;
use windows::core::*;
use windows::Win32::Foundation::*;
use windows::Win32::System::Com::*;
use webview2_com::*;
use webview2_com::Microsoft::Web::WebView2::Win32::*;

use crate::common::*;

pub struct WebView {
    pub environment: ICoreWebView2Environment2,
    pub controller: ICoreWebView2Controller,
    pub core: ICoreWebView2,
}

impl WebView {
    pub fn new(hwnd: HWND) -> Self {
        let environment =
            blocking::create_core_webview2_environment();
        let controller =
            blocking::create_core_webview2_controller(&environment, hwnd);
        let core = unsafe {
            controller
                .CoreWebView2()
                .expect("failed to get property CoreWebView2 from ICoreWebView2Controller")
        };

        // We would like to intercept all web resource requests, so we add an `*` filter here.
        // This is not necessary for general usage.
        //
        // Note that we need to use `AddWebResourceRequestedFilterWithRequestSourceKinds`
        // and specify `COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_DOCUMENT` to cover
        // requests from `<iframe>` elements as well.
        //
        // See https://github.com/MicrosoftEdge/WebView2Feedback/issues/2341#issuecomment-1332463257
        // for more details on intercepting requests from `<iframe>`.
        unsafe {
            core.cast::<ICoreWebView2_22>()
                .expect("failed to cast from ICoreWebView2 to ICoreWebView2_22")
                .AddWebResourceRequestedFilterWithRequestSourceKinds(
                    w!("*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_DOCUMENT)
                .expect("ICoreWebView2::AddWebResourceRequestedFilter failed");
        }

        Self { environment, controller, core }
    }

    pub fn set_visible(&self, visible: bool) {
        unsafe {
            self.controller
                .SetIsVisible(visible)
                .expect("ICoreWebView2Controller::SetIsVisible failed");
        }
    }

    pub fn navigate(&self, url: &str) -> anyhow::Result<()> {
        use widestring::U16CString;
        let url = U16CString::from_str(url)
            .context("failed to convert to U16CString")?;
        unsafe { self.core.Navigate(PCWSTR(url.as_ptr())) }
            .context("ICoreWebView2::Navigate failed")?;
        Ok(())
    }

    /// Registers a callback to be invoked when navigation is completed successfully.
    /// Returns a callback that removes the event handler when invoked.
    ///
    /// Note that [`ICoreWebView2::add_NavigationCompleted`] is fired for both successful
    /// and failed navigations, while this method only invokes the callback for successful
    /// navigations and panics on failed navigations.
    pub fn on_navigation_completed<F: FnMut() + 'static>(&self, mut callback: F) -> Box<dyn Fn()> {
        let mut token = 0i64;
        unsafe {
            self.core
                .add_NavigationCompleted(
                    &NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                        let args = args.ok_or(E_POINTER)?;
                        let mut success = BOOL(0);
                        args.IsSuccess(&raw mut success)?;
                        assert!(success.as_bool(), "ICoreWebView2 navigation failed: {:?}", {
                            let mut status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
                            args.WebErrorStatus(&raw mut status)
                                .map_or_else(
                                    |_| "<unknown>".into(),
                                    |()| format!("{status:?}"))
                        });
                        callback();
                        Ok(())
                    })),
                    &raw mut token)
                .expect("ICoreWebView2::add_NavigationCompleted failed");
        }

        let core_cloned = self.core.clone();
        Box::new(move || unsafe {
            core_cloned
                .remove_NavigationCompleted(token)
                .expect("ICoreWebView2::remove_NavigationCompleted failed");
        })
    }

    pub fn on_frame_navigation_starting<F>(&self, mut callback: F) -> Box<dyn Fn()>
    where
        F: FnMut(&str, Box<dyn FnOnce()>) + 'static, {
        let mut token = 0i64;
        unsafe {
            self.core
                .add_FrameNavigationStarting(
                    &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                        let args = args.ok_or(E_POINTER)?;

                        let mut uri = PWSTR::null();
                        args.Uri(&raw mut uri)?;
                        let uri =
                            widestring::U16CString::from_raw(uri.0)
                                .to_string()
                                .expect("ICoreWebView2FrameNavigationStartingEventArgs::get_Uri returns invalid UTF-16");

                        callback(uri.as_str(), Box::new(move || {
                            args.SetCancel(true)
                                .expect("ICoreWebView2FrameNavigationStartingEventArgs::Cancel failed");
                        }));

                        Ok(())
                    })),
                    &raw mut token)
                .expect("ICoreWebView2::add_FrameNavigationStarting failed");
        }

        let core_cloned = self.core.clone();
        Box::new(move || unsafe {
            core_cloned
                .remove_FrameNavigationStarting(token)
                .expect("ICoreWebView2::remove_FrameNavigationStarting failed");
        })
    }

    pub fn on_web_resource_requested<F>(&self, mut callback: F) -> Box<dyn Fn()>
    where
        F: FnMut(WebRequest) -> Option<WebResponse> + 'static, {
        let environment = self.environment.clone();
        self.on_web_resource_requested_internal(move |args| {
            let request =
                convert::convert_request(&unsafe {
                    args.Request()
                        .expect("failed to get property Request from ICoreWebView2WebResourceRequestedEventArgs")
                });
            let request =
                request
                    .expect("convert::convert_request failed");
            if let Some(response) = callback(request.clone()) {
                let response =
                    convert::convert_response(&environment, response)
                        .expect("convert::convert_response failed");
                unsafe {
                    args
                        .SetResponse(&response)
                        .expect("ICoreWebView2WebResourceRequestedEventArgs::SetResponse failed");
                }
            }
        })
    }

    fn on_web_resource_requested_internal<F>(&self, mut callback: F) -> Box<dyn Fn()>
    where
        F: FnMut(ICoreWebView2WebResourceRequestedEventArgs) + 'static, {
        let mut token = 0i64;
        unsafe {
            self.core
                .add_WebResourceRequested(
                    &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                        callback(args.ok_or(E_POINTER)?);
                        Ok(())
                    })),
                    &raw mut token)
                .expect("ICoreWebView2::add_WebResourceRequested failed");
        }

        let core_cloned = self.core.clone();
        Box::new(move || unsafe {
            core_cloned
                .remove_WebResourceRequested(token)
                .expect("ICoreWebView2::remove_WebResourceRequested failed");
        })
    }
}

mod blocking {
    use std::sync::mpsc;
    use std::sync::mpsc::Sender;
    use windows::core::*;
    use windows::Win32::Foundation::*;
    use webview2_com::*;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;

    pub fn create_core_webview2_environment() -> ICoreWebView2Environment2 {
        let (tx, rx) = mpsc::channel();

        CreateCoreWebView2EnvironmentCompletedHandler::wait_for_async_operation(
            Box::new(move |handler| unsafe {
                CreateCoreWebView2EnvironmentWithOptions(
                    None,
                    None,
                    None, &handler)
                    .map_err(webview2_com::Error::WindowsError)
            }),
            send_on_completed(tx),
        ).expect("failed to create ICoreWebView2Environment");

        rx
            .recv()
            .expect("failed to receive from mpsc channel")
            .cast::<ICoreWebView2Environment2>()
            .expect("failed to cast to ICoreWebView2Environment2")
    }

    pub fn create_core_webview2_controller(environment: &ICoreWebView2Environment2, hwnd: HWND)
        -> ICoreWebView2Controller {
        let environment = environment.clone();
        let (tx, rx) = mpsc::channel();

        CreateCoreWebView2ControllerCompletedHandler::wait_for_async_operation(
            Box::new(move |handler| unsafe {
                environment
                    .CreateCoreWebView2Controller(hwnd, &handler)
                    .map_err(webview2_com::Error::WindowsError)
            }),
            send_on_completed(tx),
        ).expect("failed to create ICoreWebView2Controller");

        rx
            .recv()
            .expect("failed to receive from mpsc channel")
    }

    #[expect(clippy::or_fun_call, reason = "function call is cheap")]
    fn send_on_completed<T: Interface + 'static>(sender: Sender<T>) -> CompletedClosure<HRESULT, Option<T>> {
        Box::new(move |error, result| {
            error?;
            result
                .map(|value| {
                    sender
                        .send(value)
                        .unwrap_or_else(|err| panic!("failed to send over channel: {err}"));
                })
                .ok_or(E_POINTER.into())
        })
    }
}

mod convert {
    use anyhow::Context as _;
    use widestring::*;
    use windows::core::*;
    use windows::Win32::Foundation::*;
    use webview2_com::*;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;

    use crate::common::*;
    use super::stream;

    pub fn convert_request(request: &ICoreWebView2WebResourceRequest) -> anyhow::Result<WebRequest> {
        let mut uri = PWSTR::null();
        let mut method = PWSTR::null();
        unsafe { request.Uri(&raw mut uri) }
            .context("ICoreWebView2WebResourceRequest::get_Uri failed")?;
        unsafe { request.Method(&raw mut method) }
            .context("ICoreWebView2WebResourceRequest::get_Method failed")?;
        let uri =
            unsafe { U16CString::from_raw(uri.0) }
                .to_string()
                .context("ICoreWebView2WebResourceRequest::get_Uri returns invalid UTF-16")?;
        let method =
            unsafe { U16CString::from_raw(method.0) }
                .to_string()
                .context("ICoreWebView2WebResourceRequest::get_Method returns invalid UTF-16")?
                .parse::<http::Method>()
                .context("http::Method::from_str failed")?;

        let headers =
            unsafe { request.Headers() }
                .context("ICoreWebView2WebResourceRequest::get_Headers failed")?;
        let headers =
            unsafe { headers.GetIterator() }
                .context("ICoreWebView2HttpRequestHeaders::GetIterator failed")?;
        let headers = {
            let mut result = Vec::new();
            loop {
                let mut has_next = BOOL(0);
                unsafe { headers.MoveNext(&raw mut has_next) }
                    .context("ICoreWebView2HttpHeadersCollectionIterator::MoveNext failed")?;
                if !has_next.as_bool() {
                    break result;
                }

                let mut name = PWSTR::null();
                let mut value = PWSTR::null();
                unsafe { headers.GetCurrentHeader(&raw mut name, &raw mut value) }
                    .context("ICoreWebView2HttpHeadersCollectionIterator::GetCurrentHeader failed")?;
                let name =
                    unsafe { U16CString::from_raw(name.0) }
                        .to_string()
                        .context("ICoreWebView2HttpHeadersCollectionIterator::GetCurrentHeader returns invalid UTF-16 for name")?;
                let value =
                    unsafe { U16CString::from_raw(value.0) }
                        .to_string()
                        .context("ICoreWebView2HttpHeadersCollectionIterator::GetCurrentHeader returns invalid UTF-16 for value")?;
                result.push((name, value));
            }
        };

        let content = match unsafe { request.Content() } {
            Ok(content) =>
                stream::read_bytes(&content)?,
            Err(err) if err.code().is_ok() =>
                Vec::new(),
            Err(err) =>
                return Err(err).context("ICoreWebView2WebResourceRequest::get_Content failed"),
        };

        let mut request =
            WebRequestBuilder::new()
                .uri(uri)
                .method(method);
        for (key, value) in headers {
            request = request.header(&key, &value);
        }

        request
            .body(content)
            .context("RequestBuilder::body failed")
    }

    pub fn convert_response(
        environment: &ICoreWebView2Environment,
        response: WebResponse)
        -> anyhow::Result<ICoreWebView2WebResourceResponse> {
        let reason_phrase =
            response
                .status()
                .canonical_reason()
                .unwrap_or("");
        let reason_phrase = U16CString::from_str(reason_phrase)
            .context("failed to convert reason phrase to U16CString")?;
        let reason_phrase = PCWSTR(reason_phrase.as_ptr());

        let headers =
            response
                .headers()
                .iter()
                .filter_map(|(name, value)| {
                    value
                        .to_str()
                        .map(|value| format!("{name}: {value}"))
                        .inspect_err(|err| log::error!("failed to convert header value to str: {err}"))
                        .ok()
                })
                .collect::<Vec<_>>()
                .join("\r\n");
        let headers = U16CString::from_str(&headers)
            .context("failed to convert headers to U16CString")?;
        let headers = PCWSTR(headers.as_ptr());

        let content = stream::from_bytes(response.body())?;
        unsafe {
            environment
                .CreateWebResourceResponse(
                    &content,
                    response.status().as_u16() as _,
                    reason_phrase,
                    headers)
                .context("ICoreWebView2Environment::CreateWebResourceResponse failed")
        }
    }
}

mod stream {
    use anyhow::Context as _;
    use windows::Win32::Foundation::*;
    use windows::Win32::System::Com::*;

    pub fn read_bytes(stream: &ISequentialStream) -> anyhow::Result<Vec<u8>> {
        const CHUNK_SIZE: usize = 4096;

        let mut chunk_list = Vec::new();
        let mut total_size = 0usize;
        loop {
            let mut chunk = vec![0u8; CHUNK_SIZE];
            let mut bytes_read = 0u32;
            let hresult = unsafe {
                stream.Read(
                    chunk.as_mut_ptr().cast(),
                    chunk.len() as _,
                    Some(&raw mut bytes_read))
            };

            hresult
                .ok()
                .context("ISequentialStream::Read failed")?;

            if bytes_read == 0 { break; }
            if bytes_read < const { CHUNK_SIZE as u32 } {
                chunk.resize(bytes_read as usize, 0);
            }

            chunk_list.push(chunk);
            total_size += bytes_read as usize;
        }

        let mut result = Vec::with_capacity(total_size);
        for chunk in chunk_list {
            result.extend(chunk);
        }

        Ok(result)
    }

    pub fn from_bytes(bytes: &[u8]) -> anyhow::Result<IStream> {
        use windows::Win32::System::Com::*;
        use windows::Win32::System::Com::StructuredStorage::*;

        let stream =
            unsafe { CreateStreamOnHGlobal(HGLOBAL::default(), true) }
                .context("CreateStreamOnHGlobal failed")?;

        let mut bytes_written = 0u32;
        let hresult = unsafe {
            stream.Write(
                bytes.as_ptr().cast(),
                bytes.len() as _,
                Some(&raw mut bytes_written))
        };

        hresult
            .ok()
            .context("IStream::Write failed")?;

        if bytes_written != bytes.len() as u32 {
            anyhow::bail!("IStream::Write wrote {bytes_written} bytes, expected {} bytes", bytes.len());
        }

        unsafe { stream.Seek(0, STREAM_SEEK_SET, None) }
            .context("IStream::Seek failed")?;
        Ok(stream)
    }
}
