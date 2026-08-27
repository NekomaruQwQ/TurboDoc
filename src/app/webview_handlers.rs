//! TurboDoc-specific WebView2 callbacks and host-to-frontend calls.

use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;
use std::sync::Arc;

use anyhow::Context as _;
use winit::window::Window;

use crate::prelude::*;
use crate::server::Server;
use crate::startup::StartupProbe;
use crate::webview::WebView;
use crate::webview::WebViewNavigationResult;

use super::frontend::FrontendKind;
use super::routing;
use super::routing::ApiRequestHandler;
use super::routing::FrameNavigationKind;

/// Queue a direct call to one named function under `window.__turboDoc__`.
///
/// `member` is supplied only by trusted native call sites. The argument is
/// serialized as JSON before entering the generated JavaScript source.
///
/// # Errors
///
/// Returns an error when argument serialization fails or WebView2 rejects the
/// newly active script synchronously.
fn call_frontend(
    webview: &WebView,
    member: &str,
    argument: Option<&serde_json::Value>)
 -> anyhow::Result<()> {
    webview.execute_script(frontend_call_source(member, argument)?)
}

/// Build an availability-checking call to one trusted frontend member.
fn frontend_call_source(
    member: &str,
    argument: Option<&serde_json::Value>)
 -> anyhow::Result<String> {
    let argument =
        argument
            .map(serde_json::to_string)
            .transpose()
            .context("failed to serialize frontend function argument")?
            .unwrap_or_default();
    Ok(format!(
        "(() => {{\n\
         \x20   const api = window.__turboDoc__;\n\
         \x20   if (typeof api?.{member} !== \"function\") {{\n\
         \x20       throw new Error(\"TurboDoc frontend function is unavailable: {member}\");\n\
         \x20   }}\n\
         \x20   api.{member}({argument});\n\
         }})()"))
}

/// Install WebView2 request and navigation handlers. `on_navigation`
/// receives exactly one result for native startup, while the persistent
/// completion handler also releases deferred iframe loading after later
/// development-server reloads.
///
/// # Errors
///
/// Returns an error when WebView2 rejects a request filter or callback
/// registration.
pub(super) fn install<F>(
    window: &Arc<Window>,
    webview: &WebView,
    api_origin: &str,
    frontend_kind: FrontendKind,
    server: Server,
    startup: StartupProbe,
    on_navigation: F)
 -> anyhow::Result<()>
where
    F: FnOnce(anyhow::Result<()>) + 'static,
{
    for uri_pattern in routing::web_resource_request_filters(api_origin) {
        webview.add_web_resource_requested_filter(&uri_pattern)?;
    }

    // The controller starts hidden to avoid exposing a partially loaded
    // WebView2 surface. Every successful frontend navigation reveals the
    // controller before notifying Svelte that iframe loading may begin;
    // retaining the handler also covers full Vite reloads.
    webview.on_navigation_completed({
        let webview = webview.clone();
        let mut initial_navigation = Some(on_navigation);
        move |result| {
            let is_initial = initial_navigation.is_some();
            let outcome =
                on_frontend_navigation_completed(
                    &webview,
                    startup,
                    &result,
                    is_initial);
            if let Some(on_navigation) = initial_navigation.take() {
                on_navigation(outcome);
            } else if let Err(err) = outcome {
                log::error!("frontend reload failed: {err:#}");
            }
        }
    })?;

    // TurboDoc has no loopback backend server. This handler supplies the
    // in-process `/api/*` routes and documentation proxy responses for the
    // exact filters above; returning `None` lets ordinary frontend resources
    // continue through WebView2's selected source.
    webview.on_web_resource_requested(move |request|
        on_web_resource_requested(&server, frontend_kind, request))?;

    // The documentation viewer is an iframe, so its navigations do not pass
    // through the top-level completion handler. Observe them here to keep
    // frontend navigation state synchronized and to cancel external
    // destinations before opening them in the system browser.
    let hosted_navigation_ids = Rc::new(RefCell::new(HashSet::new()));
    webview.on_frame_navigation_starting({
        let window = Arc::clone(window);
        let webview = webview.clone();
        let hosted_navigation_ids = Rc::clone(&hosted_navigation_ids);
        move |navigation_id, url, cancel_navigation| {
            on_frame_navigation_starting(
                &window,
                &webview,
                &hosted_navigation_ids,
                navigation_id,
                url,
                cancel_navigation);
        }
    })?;
    webview.on_frame_navigation_completed({
        let webview = webview.clone();
        let hosted_navigation_ids = Rc::clone(&hosted_navigation_ids);
        let mut first_document_completion = true;
        move |result| {
            let is_hosted_document = on_frame_navigation_completed(
                &webview,
                &hosted_navigation_ids,
                &result);
            if is_hosted_document && first_document_completion {
                startup.mark(&format!(
                    "initial document NavigationCompleted #{} ({})",
                    result.navigation_id,
                    if result.status.is_ok() { "success" } else { "failure" }));
                first_document_completion = false;
            }
        }
    })?;

    Ok(())
}

/// Reveal the loaded frontend and release its deferred documentation load.
///
/// `is_initial` controls startup telemetry only; successful reloads must
/// repeat the same visibility-before-call ordering.
fn on_frontend_navigation_completed(
    webview: &WebView,
    startup: StartupProbe,
    result: &WebViewNavigationResult,
    is_initial: bool)
 -> anyhow::Result<()> {
    match &result.status {
        Ok(()) => {
            webview.set_visible(true)?;
            call_frontend(webview, "frontendShown", None)?;
            if is_initial {
                startup.mark(&format!(
                    "WebView2 NavigationCompleted #{}; controller prepared; document loading released",
                    result.navigation_id));
            }
            Ok(())
        },
        Err(err) =>
            anyhow::bail!(
                "navigation #{} failed to load frontend with status {err:?}",
                result.navigation_id),
    }
}

/// Routes intercepted WebView2 requests to the in-process backend:
///
/// - **Docs URLs** (configured proxy prefixes, GET): through the proxy cache
///   and dark-mode injection pipeline.
/// - **Dev `/api/ready`**: passed through to Vite's readiness handler.
/// - **Release API preflights**: answered with the narrow policy required by
///   the separate, unmapped API origin.
/// - **Every other `/api` request**: dispatched to Rust, where persistence
///   owns generic `/api/data/{data_id}` and per-source
///   `/api/sources/{source_id}` routes and rejects unknown routes; release
///   responses authorize only the mapped frontend origin.
/// - **Everything else**: returns `None` so WebView2 falls through to its
///   default path.
fn on_web_resource_requested(
    server: &Server,
    frontend_kind: FrontendKind,
    request: WebRequest)
 -> Option<WebResponse> {
    use http::Method;
    let uri = request.uri().to_string();

    if request.method() == Method::GET
        && routing::PROXIED_URL.iter().any(|&prefix| uri.starts_with(prefix))
    {
        return match server.fetch(&request) {
            Ok(response) => Some(response),
            Err(err) => {
                log::error!("proxy request failed for {uri}: {err:#}");
                None
            },
        };
    }

    match routing::api_request_handler(
        frontend_kind,
        request.method(),
        request.uri().path()) {
        Some(ApiRequestHandler::Rust) => {
            let response = server.dispatch_api(request);
            return Some(match frontend_kind {
                FrontendKind::Release => routing::with_release_api_cors(response),
                FrontendKind::Dev => response,
            });
        },
        Some(ApiRequestHandler::ReleasePreflight) =>
            return Some(routing::release_api_preflight_response()),
        Some(ApiRequestHandler::Vite) => return None,
        None => {},
    }

    None
}

/// Intercepts iframe navigations.
///
/// - Known documentation URLs: call the frontend navigation-start function so
///   it can update the sidebar.
/// - Blank iframe bootstrap: allow WebView2's implicit `about:blank` without
///   treating it as document content.
/// - External URLs: cancel navigation and offer to open them in the system
///   browser.
fn on_frame_navigation_starting(
    window: &Window,
    webview: &WebView,
    hosted_navigation_ids: &RefCell<HashSet<u64>>,
    navigation_id: u64,
    url: &str,
    cancel_navigation: Box<dyn FnOnce()>) {
    log::info!("navigating to {url}");
    match routing::classify_frame_navigation(url) {
        FrameNavigationKind::BlankBootstrap =>
            log::debug!(" -> blank iframe bootstrap allowed"),
        FrameNavigationKind::Hosted => {
            hosted_navigation_ids.borrow_mut().insert(navigation_id);
            let report = serde_json::json!({
                "url": url,
                "navigationId": navigation_id.to_string(),
            });
            let _ = call_frontend(
                webview,
                "documentNavigationStarted",
                Some(&report))
                .inspect_err(|err| {
                    log::error!("failed to report document navigation start: {err}")
                });
        },
        FrameNavigationKind::External => {
            log::info!(" -> external link, navigation cancelled");
            cancel_navigation();
            open_external_link(window, url);
        },
    }
}

/// Report completion only for frame navigations accepted by TurboDoc.
///
/// Returning `true` lets the caller record the first document-completion
/// milestone without logging unrelated or cancelled external frames.
fn on_frame_navigation_completed(
    webview: &WebView,
    hosted_navigation_ids: &RefCell<HashSet<u64>>,
    result: &WebViewNavigationResult)
 -> bool {
    if !hosted_navigation_ids.borrow_mut().remove(&result.navigation_id) {
        return false;
    }

    let error = result.status.as_ref().err().map(|status| format!("{status:?}"));
    let report = serde_json::json!({
        "navigationId": result.navigation_id.to_string(),
        "success": result.status.is_ok(),
        "error": error,
    });
    let _ = call_frontend(
        webview,
        "documentNavigationCompleted",
        Some(&report))
        .inspect_err(|err| {
            log::error!("failed to report document navigation completion: {err}")
        });
    true
}

/// Confirm and open one navigation that is outside TurboDoc's hosted policy.
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
            use nkcore::prelude::RawWindowHandleExt as _;
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
        },
    }
}

#[cfg(test)]
mod tests {
    use super::frontend_call_source;

    #[test]
    fn frontend_call_source_round_trips_untrusted_argument_as_json() {
        let report = serde_json::json!({
            "url": "https://docs.rs/\"); globalThis.hacked = true; //\nserde/",
            "navigationId": "18446744073709551615",
        });
        let source =
            frontend_call_source("documentNavigationStarted", Some(&report))
                .expect("frontend source should build");
        let argument =
            source
                .lines()
                .find_map(|line| {
                    line.trim()
                        .strip_prefix("api.documentNavigationStarted(")
                        .and_then(|line| line.strip_suffix(");"))
                })
                .expect("source should contain direct frontend call");

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(argument)
                .expect("argument should remain valid JSON"),
            report);
    }

    #[test]
    fn frontend_call_source_omits_argument_for_frontend_shown() {
        let source =
            frontend_call_source("frontendShown", None)
                .expect("frontend source should build");

        assert!(source.contains("api.frontendShown();"), "source was: {source}");
    }
}
