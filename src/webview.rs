use nkcore::prelude::*;
use nkcore::debug::*;
use nkcore::*;

use std::result::Result;
use std::sync::mpsc;

use widestring::U16CString;

use windows::core::*;
use windows::Win32::Foundation::*;

use webview2_com::*;
use webview2_com::Microsoft::Web::WebView2::Win32::*;

use crate::prelude::*;

#[derive(Debug, Clone)]
pub struct WebView {
    environment: ICoreWebView2Environment2,
    controller: ICoreWebView2Controller,
    core: ICoreWebView2,
}

pub type WebViewNavigationResult = Result<(), COREWEBVIEW2_WEB_ERROR_STATUS>;

impl WebView {
    pub fn new(hwnd: HWND) -> anyhow::Result<Self> {
        let environment =
            blocking::create_core_webview2_environment();
        let controller =
            blocking::create_core_webview2_controller(&environment, hwnd);
        let core =
            unsafe { controller.CoreWebView2() }
                .context("failed to get ICoreWebView2 from ICoreWebView2Controller")?;

        // We would like to intercept all web resource requests, so we add an `*` filter here.
        // This is not necessary for general usage.
        //
        // Note that we need to use `AddWebResourceRequestedFilterWithRequestSourceKinds`
        // and specify `COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_DOCUMENT` to cover
        // requests from `<iframe>` elements as well.
        //
        // See https://github.com/MicrosoftEdge/WebView2Feedback/issues/2341#issuecomment-1332463257
        // for more details on intercepting requests from `<iframe>`.
        let core_22 = api_call!(unsafe { core.cast::<ICoreWebView2_22>() })?;
        api_call!(unsafe {
            core_22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                w!("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_DOCUMENT)
        })?;

        Ok(Self { environment, controller, core })
    }

    pub fn set_visible(&self, visible: bool) -> anyhow::Result<()> {
        api_call!(unsafe { self.controller.SetIsVisible(visible) })
    }

    pub fn set_bounds(&self, bounds: RECT) -> anyhow::Result<()> {
        api_call!(unsafe { self.controller.SetBounds(bounds) })
    }

    pub fn navigate(&self, url: &str) -> anyhow::Result<()> {
        let url =
            api_call!(U16CString::from_str(url))
                .with_context(|| context!("failed to convert argument `url` to U16CString"))?;
        api_call!(unsafe { self.core.Navigate(PCWSTR(url.as_ptr())) })
    }

    #[expect(dead_code, reason = "may be useful in the future")]
    pub fn post_message_as_string(&self, message: &str) -> anyhow::Result<()> {
        let message =
            api_call!(U16CString::from_str(message))
                .with_context(|| context!("failed to convert argument `message` to U16CString"))?;
        api_call!(unsafe { self.core.PostWebMessageAsString(PCWSTR(message.as_ptr())) })
    }

    pub fn post_message_as_json(&self, message: &str) -> anyhow::Result<()> {
        let message =
            api_call!(U16CString::from_str(message))
                .with_context(|| context!("failed to convert argument `message` to U16CString"))?;
        api_call!(unsafe { self.core.PostWebMessageAsJson(PCWSTR(message.as_ptr())) })
    }

    /// Registers a callback to be invoked when the next navigation is completed successfully.
    /// Returns a callback that removes the event handler when invoked.
    pub fn on_next_navigation_completed<F>(&self, callback: F) -> anyhow::Result<()>
    where
        F: FnOnce(Result<(), COREWEBVIEW2_WEB_ERROR_STATUS>) + 'static {
        let (token_tx, token_rx) = mpsc::sync_channel::<i64>(1);
        let mut state = Some((self.core.clone(), token_rx, callback));

        let handler = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
            Self::on_next_navigation_completed_handler(&mut state, args.as_ref())
                .context("an error occurred while handling webview event `NavigationCompleted`")
                .map_err(|err| {
                    log::error!("{err}");
                    E_UNEXPECTED.into()
                })
        }));

        let mut token = 0i64;
        api_call!(unsafe { self.core.add_NavigationCompleted(&handler, &raw mut token) })?;
        token_tx
            .send(token)
            .context("failed to send over mpsc channel")?;
        Ok(())
    }

    fn on_next_navigation_completed_handler<F>(
        state: &mut Option<(ICoreWebView2, mpsc::Receiver<i64>, F)>,
        args: Option<&ICoreWebView2NavigationCompletedEventArgs>)
     -> anyhow::Result<()>
    where
        F: FnOnce(WebViewNavigationResult) + 'static {
        let Some(args) = args else {
            anyhow::bail!("NavigationCompleted event args is null");
        };

        let Some((webview, token_rx, callback)) = state.take() else {
            anyhow::bail!("NavigationCompleted event handler called multiple times");
        };

        let token = api_call!(token_rx.recv())?;

        api_call!(unsafe { webview.remove_NavigationCompleted(token) })?;

        let success =
            out_var_or_err(|out| api_call!(unsafe { args.IsSuccess(out)}))?
                .as_bool();
        let result = if success {
            Ok(())
        } else {
            Err(out_var_or_err(|out| api_call!(unsafe { args.WebErrorStatus(out) }))?)
        };

        callback(result);
        Ok(())
    }

    pub fn on_frame_navigation_starting<F>(&self, mut callback: F) -> anyhow::Result<()>
    where
        F: FnMut(&str, Box<dyn FnOnce()>) + 'static, {
        let handler = NavigationStartingEventHandler::create(Box::new(move |_, args| {
            Self::on_frame_navigation_starting_handler(args.as_ref(), &mut callback)
                .context("an error occurred while handling webview event `FrameNavigationStarting`")
                .map_err(|err| {
                    log::error!("{err}");
                    E_UNEXPECTED.into()
                })
        }));

        let mut token = 0i64;
        api_call!(unsafe { self.core.add_FrameNavigationStarting(&handler, &raw mut token) })
    }

    fn on_frame_navigation_starting_handler<F>(
        args: Option<&ICoreWebView2NavigationStartingEventArgs>,
        callback: &mut F)
     -> anyhow::Result<()>
    where
        F: FnMut(&str, Box<dyn FnOnce()>) + 'static, {
        let Some(args) = args else {
            anyhow::bail!("FrameNavigationStarting event args is null");
        };

        let mut uri = PWSTR::null();
        unsafe { args.Uri(&raw mut uri) }
            .context("ICoreWebView2NavigationStartingEventArgs::get_Uri failed")?;

        let uri =
            unsafe { U16CString::from_raw(uri.0) }
                .to_string()
                .context("ICoreWebView2NavigationStartingEventArgs::get_Uri returns invalid UTF-16")?;

        let args = args.clone();
        callback(&uri, Box::new(move || {
            api_call!(unsafe { args.SetCancel(true) })
                .unwrap_or_else(|err| log::error!("{err}"));
        }));

        Ok(())
    }

    pub fn on_web_resource_requested<F>(&self, mut callback: F) -> anyhow::Result<()>
    where
        F: FnMut(WebRequest) -> Option<WebResponse> + 'static, {
        let environment = self.environment.clone();
        let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
            Self::on_web_resource_requested_handler(&environment, args.as_ref(), &mut callback)
                .context("an error occurred while handling webview event `WebResourceRequested`")
                .map_err(|err| {
                    log::error!("{err}");
                    E_UNEXPECTED.into()
                })
        }));

        let mut token = 0i64;
        api_call!(unsafe { self.core.add_WebResourceRequested(&handler, &raw mut token) })
    }

    fn on_web_resource_requested_handler<F>(
        environment: &ICoreWebView2Environment2,
        args: Option<&ICoreWebView2WebResourceRequestedEventArgs>,
        callback: &mut F)
     -> anyhow::Result<()>
    where
        F: FnMut(WebRequest) -> Option<WebResponse> + 'static, {
        let Some(args) = args else {
            anyhow::bail!("WebResourceRequested event args is null");
        };

        let request =
            unsafe { args.Request() }
                .context("ICoreWebView2WebResourceRequestedEventArgs::get_Request failed")?;
        let request = convert::convert_request(&request)?;

        if let Some(response) = callback(request) {
            let response = convert::convert_response(environment, &response)?;
            api_call!(unsafe { args.SetResponse(&response) })?;
        }

        Ok(())
    }

    pub fn on_web_message_received<F>(&self, mut callback: F) -> anyhow::Result<()>
    where
        F: FnMut(&str) + 'static, {
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            Self::on_web_message_received_handler(args.as_ref(), &mut callback)
                .context("an error occurred while handling webview event `WebMessageReceived`")
                .map_err(|err| {
                    log::error!("{err}");
                    E_UNEXPECTED.into()
                })
        }));

        let mut token = 0i64;
        api_call!(unsafe { self.core.add_WebMessageReceived(&handler, &raw mut token) })
    }

    fn on_web_message_received_handler<F>(
        args: Option<&ICoreWebView2WebMessageReceivedEventArgs>,
        callback: &mut F)
     -> anyhow::Result<()>
    where
        F: FnMut(&str) + 'static, {
        let Some(args) = args else {
            anyhow::bail!("WebMessageReceived event args is null");
        };

        let mut message = PWSTR::null();
        api_call!(unsafe { args.TryGetWebMessageAsString(&raw mut message) })?;

        let message =
            unsafe { U16CString::from_raw(message.0) }
                .to_string()
                .context("ICoreWebView2WebMessageReceivedEventArgs::TryGetWebMessageAsString returns invalid UTF-16")?;

        callback(&message);
        Ok(())
    }
}

mod blocking {
    use super::*;
    use std::sync::mpsc;
    use std::sync::mpsc::Sender;

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
    use webview2_com::Microsoft::Web::WebView2::Win32::*;

    use crate::prelude::*;
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
        response: &WebResponse)
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
    use nkcore::prelude::*;
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
            unsafe { CreateStreamOnHGlobal(default(), true) }
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
