use nkcore::prelude::*;
use nkcore::debug::*;
use nkcore::*;

use std::cell::RefCell;
use std::collections::VecDeque;
use std::path::Path;
use std::rc::Rc;
use std::result::Result;
use std::time::Instant;

use widestring::U16CString;

use windows::core::*;
use windows::Win32::Foundation::*;

use webview2_com::*;
use webview2_com::take_pwstr;
use webview2_com::Microsoft::Web::WebView2::Win32::*;

use crate::prelude::*;
use crate::startup::StartupProbe;

#[derive(Debug, Clone)]
pub struct WebView {
    environment: ICoreWebView2Environment2,
    controller: ICoreWebView2Controller,
    core: ICoreWebView2,
    /// Shared FIFO whose front entry remains present while WebView2 executes it.
    script_queue: Rc<RefCell<VecDeque<String>>>,
}

/// Outcome and WebView2 correlation ID for one top-level navigation.
#[derive(Debug)]
pub struct WebViewNavigationResult {
    pub navigation_id: u64,
    pub status: Result<(), COREWEBVIEW2_WEB_ERROR_STATUS>,
}

/// One-shot callback shared between the two asynchronous WebView2 creation
/// stages. Both completion handlers run on the UI thread, so `Rc<RefCell<_>>`
/// preserves the COM apartment boundary without synchronization overhead.
type WebViewCreationCallback =
    Rc<RefCell<Option<Box<dyn FnOnce(anyhow::Result<WebView>)>>>>;

impl WebView {
    /// Begin creating an initially hidden WebView2 controller for `hwnd`.
    ///
    /// The controller's default background is configured during creation so
    /// revealing it after navigation cannot expose WebView2's white default.
    /// WebView2 invokes `callback` on the UI thread after both its environment
    /// and controller are ready, or after either asynchronous stage fails.
    pub fn begin_create<F>(
        hwnd: HWND,
        startup: StartupProbe,
        callback: F)
     -> anyhow::Result<()>
    where
        F: FnOnce(anyhow::Result<Self>) + 'static {
        let callback: WebViewCreationCallback =
            Rc::new(RefCell::new(Some(Box::new(callback))));
        let environment_started_at = Instant::now();
        let completion_callback = Rc::clone(&callback);
        let handler =
            CreateCoreWebView2EnvironmentCompletedHandler::create(
                Box::new(move |error_code, environment| {
                    let result = (|| {
                        error_code
                            .ok()
                            .context("WebView2 environment creation failed")?;
                        let environment =
                            environment
                                .context("WebView2 returned no environment")?
                                .cast::<ICoreWebView2Environment2>()
                                .context("failed to cast to ICoreWebView2Environment2")?;
                        startup.mark_phase(
                            "WebView2 environment created",
                            environment_started_at);
                        Self::begin_controller_creation(
                            environment,
                            hwnd,
                            startup,
                            Rc::clone(&completion_callback))
                    })();

                    if let Err(err) = result {
                        Self::finish_creation(
                            &completion_callback,
                            Err(err.context("failed to create WebView2")));
                    }
                    Ok(())
                }));

        unsafe {
            CreateCoreWebView2EnvironmentWithOptions(
                None,
                None,
                None,
                &handler)
        }
        .map_err(webview2_com::Error::WindowsError)
        .context("failed to start WebView2 environment creation")
    }

    /// Begin the controller half of WebView2 creation after the environment
    /// callback succeeds. The environment is retained in the final wrapper
    /// because response conversion later depends on it.
    fn begin_controller_creation(
        environment: ICoreWebView2Environment2,
        hwnd: HWND,
        startup: StartupProbe,
        callback: WebViewCreationCallback)
     -> anyhow::Result<()> {
        let environment_10 =
            environment
                .cast::<ICoreWebView2Environment10>()
                .context("failed to cast to ICoreWebView2Environment10")?;
        let controller_options =
            Self::create_controller_options(&environment_10)?;

        let controller_started_at = Instant::now();
        let completion_environment = environment.clone();
        let completion_callback = Rc::clone(&callback);
        let handler =
            CreateCoreWebView2ControllerCompletedHandler::create(
                Box::new(move |error_code, controller| {
                    let result = (|| {
                        error_code
                            .ok()
                            .context("WebView2 controller creation failed")?;
                        let controller =
                            controller
                                .context("WebView2 returned no controller")?;
                        startup.mark_phase(
                            "WebView2 controller created",
                            controller_started_at);
                        api_call!(unsafe { controller.SetIsVisible(false) })?;

                        let core =
                            unsafe { controller.CoreWebView2() }
                                .context(
                                    "failed to get ICoreWebView2 from \
                                     ICoreWebView2Controller")?;
                        startup.mark(
                            "WebView2 core acquired and controller hidden");
                        Ok(Self {
                            environment: completion_environment,
                            controller,
                            core,
                            script_queue: Default::default(),
                        })
                    })();
                    Self::finish_creation(&completion_callback, result);
                    Ok(())
                }));

        unsafe {
            environment_10.CreateCoreWebView2ControllerWithOptions(
                hwnd,
                &controller_options,
                &handler)
        }
        .map_err(webview2_com::Error::WindowsError)
        .context("failed to start WebView2 controller creation")
    }

    /// Configure the opaque startup color before WebView2 creates its child
    /// window. Applying this after controller creation leaves a white-flash
    /// race when the hidden controller is eventually revealed.
    fn create_controller_options(
        environment: &ICoreWebView2Environment10)
     -> anyhow::Result<ICoreWebView2ControllerOptions> {
        let controller_options =
            unsafe { environment.CreateCoreWebView2ControllerOptions() }
                .context("failed to create WebView2 controller options")?;
        let controller_options_3 =
            controller_options
                .cast::<ICoreWebView2ControllerOptions3>()
                .context("failed to cast to ICoreWebView2ControllerOptions3")?;
        let color = crate::startup::STARTUP_BACKGROUND;
        unsafe {
            controller_options_3.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR {
                A: 255,
                R: color.red,
                G: color.green,
                B: color.blue,
            })
        }
        .context("failed to set WebView2 startup background")?;
        Ok(controller_options)
    }

    /// Deliver the asynchronous creation result exactly once. A duplicate
    /// completion indicates a WebView2 callback-contract violation, so it is
    /// logged rather than panicking across the COM callback boundary.
    fn finish_creation(
        callback: &WebViewCreationCallback,
        result: anyhow::Result<Self>) {
        let Some(callback) = callback.borrow_mut().take() else {
            log::error!("WebView2 creation completed more than once");
            return;
        };
        callback(result);
    }

    /// Raise `WebResourceRequested` only for requests matching `uri_pattern`.
    ///
    /// The document source-kind includes requests originating from the
    /// frontend and its documentation iframe. Callers must register every
    /// required pattern before the initial navigation.
    pub fn add_web_resource_requested_filter(&self, uri_pattern: &str) -> anyhow::Result<()> {
        let uri_pattern =
            api_call!(U16CString::from_str(uri_pattern))
                .with_context(|| context!("failed to convert argument `uri_pattern` to U16CString"))?;
        let core_22 = api_call!(unsafe { self.core.cast::<ICoreWebView2_22>() })?;
        api_call!(unsafe {
            core_22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                PCWSTR(uri_pattern.as_ptr()),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_DOCUMENT)
        })
    }

    pub fn set_visible(&self, visible: bool) -> anyhow::Result<()> {
        api_call!(unsafe { self.controller.SetIsVisible(visible) })
    }

    pub fn set_bounds(&self, bounds: RECT) -> anyhow::Result<()> {
        api_call!(unsafe { self.controller.SetBounds(bounds) })
    }

    /// Map one virtual HTTPS host to a local static-resource directory.
    ///
    /// Cross-origin access is denied because TurboDoc's release frontend only
    /// needs same-origin HTML, module, stylesheet, and application API access.
    ///
    /// # Errors
    ///
    /// Returns an error when either argument contains a null code unit, the
    /// installed WebView2 runtime lacks the required interface, or WebView2
    /// rejects the mapping (including an overlong folder path).
    pub fn set_virtual_host_name_to_folder_mapping(
        &self,
        host_name: &str,
        folder_path: &Path)
     -> anyhow::Result<()> {
        let host_name =
            api_call!(U16CString::from_str(host_name))
                .with_context(|| context!(
                    "failed to convert argument `host_name` to U16CString"))?;
        let folder_path =
            api_call!(U16CString::from_os_str(folder_path.as_os_str()))
                .with_context(|| context!(
                    "failed to convert argument `folder_path` to U16CString"))?;
        let core_3 = api_call!(unsafe { self.core.cast::<ICoreWebView2_3>() })?;
        api_call!(unsafe {
            core_3.SetVirtualHostNameToFolderMapping(
                PCWSTR(host_name.as_ptr()),
                PCWSTR(folder_path.as_ptr()),
                COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY)
        })
    }

    /// Close the controller and release its registered event handlers.
    ///
    /// Consuming the wrapper prevents further calls after WebView2 invalidates
    /// the controller and breaks callback reference cycles during host exit.
    ///
    /// # Errors
    ///
    /// Returns an error when WebView2 rejects the synchronous close request.
    pub fn close(self) -> anyhow::Result<()> {
        api_call!(unsafe { self.controller.Close() })
    }

    pub fn navigate(&self, url: &str) -> anyhow::Result<()> {
        let url =
            api_call!(U16CString::from_str(url))
                .with_context(|| context!("failed to convert argument `url` to U16CString"))?;
        api_call!(unsafe { self.core.Navigate(PCWSTR(url.as_ptr())) })
    }

    /// Open the Edge DevTools window for this WebView2 instance. Useful as
    /// a development affordance — the in-iframe right-click menu is owned
    /// by the docs-site's CSS/JS and may suppress the WebView2 default
    /// context menu, so this gives a reliable path to inspect the host UI.
    #[expect(dead_code, reason = "may be useful in the future")]
    pub fn open_devtools(&self) -> anyhow::Result<()> {
        api_call!(unsafe { self.core.OpenDevToolsWindow() })
    }

    /// Queue JavaScript for ordered asynchronous execution in the current page.
    ///
    /// The in-flight source remains at the front of the shared FIFO until its
    /// completion callback runs; an empty queue therefore denotes the idle
    /// state without separate bookkeeping.
    ///
    /// # Errors
    ///
    /// Returns an error when WebView2 rejects the newly active script
    /// synchronously. Later asynchronous failures are logged with their full
    /// source from the completion callback without blocking the UI thread.
    pub fn execute_script(&self, source: String) -> anyhow::Result<()> {
        let should_start = {
            let mut queue = self.script_queue.borrow_mut();
            queue.push_back(source);
            queue.len() == 1
        };
        if should_start {
            let outcome = Self::start_next_script(&self.core, &self.script_queue);
            if outcome.is_err() {
                Self::continue_script_queue(&self.core, &self.script_queue);
            }
            outcome?;
        }
        Ok(())
    }

    /// Submit the source retained at the front of the queue.
    fn start_next_script(
        core: &ICoreWebView2,
        queue: &Rc<RefCell<VecDeque<String>>>)
     -> anyhow::Result<()> {
        let outcome = (|| {
            let source = {
                let queue = queue.borrow();
                let Some(source) = queue.front() else { return Ok(()); };
                U16CString::from_str(source)
                    .context("failed to convert JavaScript source to U16CString")?
            };
            let core_21 =
                core.cast::<ICoreWebView2_21>()
                    .context("failed to cast to ICoreWebView2_21")?;

            let completion_core = core.clone();
            let completion_queue = Rc::clone(queue);
            let handler =
                ExecuteScriptWithResultCompletedHandler::create(
                    Box::new(move |operation_status, result| {
                        let source = completion_queue.borrow_mut().pop_front();
                        if let Some(source) = source {
                            Self::inspect_script_result(operation_status, result)
                                .inspect_err(|err| {
                                    log::error!(
                                        "JavaScript execution failed for {source:?}: {err:#}")
                                })
                                .ok();
                        } else {
                            log::error!(
                                "WebView2 completed JavaScript execution without a queued source");
                        }
                        Self::continue_script_queue(&completion_core, &completion_queue);
                        Ok(())
                    }));

            api_call!(unsafe {
                core_21.ExecuteScriptWithResult(PCWSTR(source.as_ptr()), &handler)
            })
        })();
        if let Err(err) = outcome {
            let source = queue.borrow_mut().pop_front();
            return match source {
                Some(source) =>
                    Err(err).with_context(|| {
                        context!("failed to start JavaScript execution for {source:?}")
                    }),
                None =>
                    Err(err).context(
                        "failed to start JavaScript execution without a queued source"),
            };
        }
        Ok(())
    }

    /// Continue past synchronous submission failures until a call starts or
    /// the queue becomes empty.
    fn continue_script_queue(
        core: &ICoreWebView2,
        queue: &Rc<RefCell<VecDeque<String>>>) {
        loop {
            match Self::start_next_script(core, queue) {
                Ok(()) => return,
                Err(err) =>
                    log::error!("failed to continue JavaScript queue: {err:#}"),
            }
        }
    }

    /// Convert WebView2's asynchronous result into a diagnostic Rust result.
    fn inspect_script_result(
        operation_status: windows::core::Result<()>,
        result: Option<ICoreWebView2ExecuteScriptResult>)
     -> anyhow::Result<()> {
        operation_status.context("WebView2 rejected JavaScript execution")?;
        let result = result.context("WebView2 returned no JavaScript execution result")?;
        let succeeded =
            out_var_or_err(|out| api_call!(unsafe { result.Succeeded(out) }))?
                .as_bool();
        if succeeded { return Ok(()); }

        let exception =
            unsafe { result.Exception() }
                .context("failed to get JavaScript exception")?;
        let mut exception_json = PWSTR::null();
        unsafe { exception.ToJson(&raw mut exception_json) }
            .context("failed to serialize JavaScript exception")?;
        anyhow::bail!("JavaScript exception: {}", take_pwstr(exception_json))
    }

    /// Observe every completed top-level navigation for this WebView2 instance.
    ///
    /// The callback receives both successful and failed results. The handler
    /// remains registered for the controller lifetime so development-server
    /// reloads can repeat the frontend-visible notification.
    pub fn on_navigation_completed<F>(&self, mut callback: F) -> anyhow::Result<()>
    where
        F: FnMut(WebViewNavigationResult) + 'static {
        let handler = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
            Self::navigation_result(args.as_ref())
                .map(&mut callback)
                .context("an error occurred while handling webview event `NavigationCompleted`")
                .map_err(|err| {
                    log::error!("{err}");
                    E_UNEXPECTED.into()
                })
        }));

        let mut token = 0i64;
        api_call!(unsafe { self.core.add_NavigationCompleted(&handler, &raw mut token) })
    }

    /// Observe every completed child-frame navigation.
    ///
    /// Frame navigation IDs remain `u64` until the host serializes them as
    /// strings for JavaScript, avoiding integer-precision loss at the native
    /// boundary.
    pub fn on_frame_navigation_completed<F>(&self, mut callback: F) -> anyhow::Result<()>
    where
        F: FnMut(WebViewNavigationResult) + 'static {
        let handler = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
            Self::navigation_result(args.as_ref())
                .map(&mut callback)
                .context("an error occurred while handling webview event `FrameNavigationCompleted`")
                .map_err(|err| {
                    log::error!("{err}");
                    E_UNEXPECTED.into()
                })
        }));

        let mut token = 0i64;
        api_call!(unsafe { self.core.add_FrameNavigationCompleted(&handler, &raw mut token) })
    }

    /// Convert WebView2 completion arguments into the host's correlation type.
    ///
    /// # Errors
    ///
    /// Returns an error when WebView2 supplies null arguments or rejects any
    /// completion-status property read.
    fn navigation_result(
        args: Option<&ICoreWebView2NavigationCompletedEventArgs>)
     -> anyhow::Result<WebViewNavigationResult> {
        let Some(args) = args else {
            anyhow::bail!("NavigationCompleted event args is null");
        };

        let navigation_id =
            out_var_or_err(|out| api_call!(unsafe { args.NavigationId(out) }))?;
        let success =
            out_var_or_err(|out| api_call!(unsafe { args.IsSuccess(out)}))?
                .as_bool();
        let status = if success {
            Ok(())
        } else {
            Err(out_var_or_err(|out| api_call!(unsafe { args.WebErrorStatus(out) }))?)
        };

        Ok(WebViewNavigationResult {
            navigation_id,
            status,
        })
    }

    pub fn on_frame_navigation_starting<F>(&self, mut callback: F) -> anyhow::Result<()>
    where
        F: FnMut(u64, &str, Box<dyn FnOnce()>) + 'static, {
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
        F: FnMut(u64, &str, Box<dyn FnOnce()>) + 'static, {
        let Some(args) = args else {
            anyhow::bail!("FrameNavigationStarting event args is null");
        };

        let navigation_id =
            out_var_or_err(|out| api_call!(unsafe { args.NavigationId(out) }))?;
        let mut uri = PWSTR::null();
        unsafe { args.Uri(&raw mut uri) }
            .context("ICoreWebView2NavigationStartingEventArgs::get_Uri failed")?;

        let uri = take_pwstr(uri);

        let args = args.clone();
        callback(navigation_id, &uri, Box::new(move || {
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

}

mod convert {
    use anyhow::Context as _;
    use webview2_com::take_pwstr;
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
        let uri = take_pwstr(uri);
        let method = take_pwstr(method)
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
                let mut has_current = BOOL(0);
                unsafe { headers.HasCurrentHeader(&raw mut has_current) }
                    .context("ICoreWebView2HttpHeadersCollectionIterator::HasCurrentHeader failed")?;
                if !has_current.as_bool() {
                    break result;
                }

                let mut name = PWSTR::null();
                let mut value = PWSTR::null();
                unsafe { headers.GetCurrentHeader(&raw mut name, &raw mut value) }
                    .context("ICoreWebView2HttpHeadersCollectionIterator::GetCurrentHeader failed")?;
                let name = take_pwstr(name);
                let value = take_pwstr(value);
                result.push((name, value));

                let mut _has_next = BOOL(0);
                unsafe { headers.MoveNext(&raw mut _has_next) }
                    .context("ICoreWebView2HttpHeadersCollectionIterator::MoveNext failed")?;
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
