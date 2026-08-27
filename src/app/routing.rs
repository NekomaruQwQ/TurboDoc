//! Auditable URL, request-ownership, and release CORS policy.

use crate::prelude::WebResponse;

use super::frontend::FrontendKind;
use super::frontend::RELEASE_FRONTEND_ORIGIN;
use super::frontend::RESOURCE_EXISTS_HEADER;

/// URL prefixes that the host can navigate to instead of opening in the
/// external browser.
pub(super) const HOSTED_URL: &[&str] = &[
    "https://docs.rs/",
    "https://doc.rust-lang.org/",
    "https://rust-analyzer.github.io/book/",
    "https://rustc-dev-guide.rust-lang.org/",
    "https://rust-lang.github.io/rustup/",
    "https://microsoft.github.io/windows-docs-rs/doc/",
    "https://en.wikipedia.org/",
    "https://minecraft.wiki/",
];

/// URL prefixes that the host intercepts and proxies to the server instead of
/// letting WebView2 handle them directly.
pub(super) const PROXIED_URL: &[&str] = &[
    "https://docs.rs/",
    "https://doc.rust-lang.org/",
    "https://rust-analyzer.github.io/book/",
    "https://rustc-dev-guide.rust-lang.org/",
    "https://rust-lang.github.io/rustup/",
    "https://microsoft.github.io/windows-docs-rs/doc/",
    "https://en.wikipedia.org/",
    "https://minecraft.wiki/",
    "https://index.crates.io/",
    "https://crates.io/api/v1/crates/",
];

/// Host policy for a child-frame navigation request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum FrameNavigationKind {
    /// WebView2's implicit navigation for an iframe without a `src`.
    BlankBootstrap,
    /// Documentation that remains inside TurboDoc's viewer.
    Hosted,
    /// A destination that must be cancelled and offered to the OS browser.
    External,
}

/// Classify a child-frame URL before applying navigation side effects.
///
/// Only the exact browser-generated `about:blank` URL bypasses normal URL
/// policy. Other browser-internal schemes remain external and cancelled.
pub(super) fn classify_frame_navigation(url: &str) -> FrameNavigationKind {
    if url == "about:blank" {
        FrameNavigationKind::BlankBootstrap
    } else if HOSTED_URL.iter().any(|&prefix| url.starts_with(prefix)) {
        FrameNavigationKind::Hosted
    } else {
        FrameNavigationKind::External
    }
}

/// Build the exact WebView2 URL patterns whose requests TurboDoc handles.
///
/// Proxy bases end in `/`, so appending `*` cannot accidentally match a
/// longer hostname. The API patterns are scoped to the selected API origin
/// instead of intercepting unrelated traffic. Both `/api` and its descendants
/// are covered so unknown API requests cannot fall through to frontend asset
/// handling.
pub(super) fn web_resource_request_filters(api_origin: &str) -> Vec<String> {
    let proxy_filters =
        PROXIED_URL
            .iter()
            .map(|base_url| format!("{base_url}*"));
    let api_origin = api_origin.trim_end_matches('/');
    let api_filters = [
        format!("{api_origin}/api"),
        format!("{api_origin}/api/*"),
    ];
    proxy_filters
        .chain(api_filters)
        .collect()
}

/// Owner of a request inside the frontend's `/api` namespace.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ApiRequestHandler {
    /// The in-process Rust dispatcher handles persistence and rejections.
    Rust,
    /// The host answers a release-mode cross-origin preflight directly.
    ReleasePreflight,
    /// Vite handles its launch-token-protected readiness route.
    Vite,
}

/// Classify frontend API paths without prefix ambiguity.
///
/// `/api/ready` is Vite-owned only in dev mode. Rust receives the entire
/// release namespace and all remaining dev paths so unknown routes get an
/// explicit response instead of falling through to frontend content. Release
/// `OPTIONS` requests are separated because the API has a distinct origin
/// from the mapped static frontend.
pub(super) fn api_request_handler(
    frontend_kind: FrontendKind,
    method: &http::Method,
    path: &str)
 -> Option<ApiRequestHandler> {
    if frontend_kind == FrontendKind::Dev && path == "/api/ready" {
        Some(ApiRequestHandler::Vite)
    } else if frontend_kind == FrontendKind::Release
        && *method == http::Method::OPTIONS
        && (path == "/api" || path.starts_with("/api/"))
    {
        Some(ApiRequestHandler::ReleasePreflight)
    } else if path == "/api" || path.starts_with("/api/") {
        Some(ApiRequestHandler::Rust)
    } else {
        None
    }
}

/// Authorize one release API response for the mapped frontend only.
///
/// The exact origin deliberately prevents hosted documentation frames from
/// reading application data even though their requests share this WebView2.
pub(super) fn with_release_api_cors(mut response: WebResponse) -> WebResponse {
    response.headers_mut().insert(
        http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
        http::HeaderValue::from_static(RELEASE_FRONTEND_ORIGIN));
    response.headers_mut().insert(
        http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
        http::HeaderValue::from_static(RESOURCE_EXISTS_HEADER));
    response.headers_mut().append(
        http::header::VARY,
        http::HeaderValue::from_static("Origin"));
    response
}

/// Build the fixed preflight response for release-mode application data.
pub(super) fn release_api_preflight_response() -> WebResponse {
    let mut response = WebResponse::new(Vec::new());
    *response.status_mut() = http::StatusCode::NO_CONTENT;
    response.headers_mut().insert(
        http::header::ACCESS_CONTROL_ALLOW_METHODS,
        http::HeaderValue::from_static("GET, PUT, OPTIONS"));
    response.headers_mut().insert(
        http::header::ACCESS_CONTROL_ALLOW_HEADERS,
        http::HeaderValue::from_static("Content-Type"));
    response.headers_mut().insert(
        http::header::ACCESS_CONTROL_MAX_AGE,
        http::HeaderValue::from_static("600"));
    response.headers_mut().insert(
        http::header::CONTENT_LENGTH,
        http::HeaderValue::from_static("0"));
    with_release_api_cors(response)
}

#[cfg(test)]
mod tests {
    use super::ApiRequestHandler;
    use super::FrameNavigationKind;
    use super::HOSTED_URL;
    use super::PROXIED_URL;
    use super::api_request_handler;
    use super::classify_frame_navigation;
    use super::release_api_preflight_response;
    use super::web_resource_request_filters;
    use super::with_release_api_cors;
    use crate::app::frontend::FrontendKind;
    use crate::app::frontend::RELEASE_API_ORIGIN;
    use crate::app::frontend::RELEASE_FRONTEND_ORIGIN;

    #[test]
    fn sourceless_iframe_bootstrap_is_allowed() {
        assert_eq!(
            classify_frame_navigation("about:blank"),
            FrameNavigationKind::BlankBootstrap);
    }

    #[test]
    fn other_browser_internal_urls_remain_external() {
        assert_eq!(
            classify_frame_navigation("about:srcdoc"),
            FrameNavigationKind::External);
    }

    #[test]
    fn documentation_url_remains_hosted() {
        assert_eq!(
            classify_frame_navigation("https://docs.rs/serde/latest/serde/"),
            FrameNavigationKind::Hosted);
    }

    #[test]
    fn general_documentation_urls_remain_hosted() {
        assert_eq!(
            (
                classify_frame_navigation(
                    "https://en.wikipedia.org/wiki/Rust_(programming_language)"),
                classify_frame_navigation("https://minecraft.wiki/w/Redstone")),
            (FrameNavigationKind::Hosted, FrameNavigationKind::Hosted));
    }

    #[test]
    fn lookalike_documentation_hostname_remains_external() {
        assert_eq!(
            classify_frame_navigation(
                "https://docs.rs.example.com/serde/latest/serde/"),
            FrameNavigationKind::External);
    }

    #[test]
    fn unsupported_https_url_remains_external() {
        assert_eq!(
            classify_frame_navigation("https://example.com/"),
            FrameNavigationKind::External);
    }

    #[test]
    fn data_api_is_owned_by_rust() {
        assert_eq!(
            api_request_handler(
                FrontendKind::Dev,
                &http::Method::GET,
                "/api/data/rust"),
            Some(ApiRequestHandler::Rust));
    }

    #[test]
    fn source_api_is_owned_by_rust() {
        assert_eq!(
            api_request_handler(
                FrontendKind::Dev,
                &http::Method::GET,
                "/api/sources/rust-crates"),
            Some(ApiRequestHandler::Rust));
    }

    #[test]
    fn ready_api_is_owned_by_vite_in_dev_mode() {
        assert_eq!(
            api_request_handler(
                FrontendKind::Dev,
                &http::Method::GET,
                "/api/ready"),
            Some(ApiRequestHandler::Vite));
    }

    #[test]
    fn ready_api_is_rejected_by_rust_in_release_mode() {
        assert_eq!(
            api_request_handler(
                FrontendKind::Release,
                &http::Method::GET,
                "/api/ready"),
            Some(ApiRequestHandler::Rust));
    }

    #[test]
    fn unknown_api_is_rejected_by_rust() {
        assert_eq!(
            api_request_handler(
                FrontendKind::Dev,
                &http::Method::GET,
                "/api/database"),
            Some(ApiRequestHandler::Rust));
    }

    #[test]
    fn api_prefix_without_separator_is_not_intercepted() {
        assert_eq!(
            api_request_handler(
                FrontendKind::Dev,
                &http::Method::GET,
                "/apiary"),
            None);
    }

    #[test]
    fn release_options_are_owned_by_the_preflight_policy() {
        assert_eq!(
            api_request_handler(
                FrontendKind::Release,
                &http::Method::OPTIONS,
                "/api/data/rust"),
            Some(ApiRequestHandler::ReleasePreflight));
    }

    #[test]
    fn release_preflight_exposes_only_the_application_api_contract() {
        let response = release_api_preflight_response();

        assert_eq!(
            (
                response.status(),
                response.headers()[http::header::ACCESS_CONTROL_ALLOW_ORIGIN]
                    .to_str().expect("static origin header should be text"),
                response.headers()[http::header::ACCESS_CONTROL_ALLOW_METHODS]
                    .to_str().expect("static method header should be text"),
                response.headers()[http::header::ACCESS_CONTROL_ALLOW_HEADERS]
                    .to_str().expect("static allowed-header value should be text"),
                response.headers()[http::header::ACCESS_CONTROL_EXPOSE_HEADERS]
                    .to_str().expect("static exposed-header value should be text"),
                response.headers()[http::header::ACCESS_CONTROL_MAX_AGE]
                    .to_str().expect("static max-age header should be text")),
            (
                http::StatusCode::NO_CONTENT,
                "https://turbodoc.example",
                "GET, PUT, OPTIONS",
                "Content-Type",
                "x-turbodoc-resource-exists",
                "600"));
    }

    #[test]
    fn release_cors_preserves_backend_error_responses() {
        let response = with_release_api_cors(
            http::Response::builder()
                .status(http::StatusCode::NOT_FOUND)
                .body(b"not found".to_vec())
                .expect("test response should build"));

        assert_eq!(
            (
                response.status(),
                response.body().as_slice(),
                response.headers()[http::header::ACCESS_CONTROL_ALLOW_ORIGIN]
                    .to_str().expect("static origin header should be text"),
                response.headers()[http::header::ACCESS_CONTROL_EXPOSE_HEADERS]
                    .to_str().expect("static exposed-header value should be text")),
            (
                http::StatusCode::NOT_FOUND,
                b"not found".as_slice(),
                "https://turbodoc.example",
                "x-turbodoc-resource-exists"));
    }

    #[test]
    fn web_resource_filters_are_scoped_to_handled_urls() {
        assert_eq!(
            web_resource_request_filters("http://localhost:5173/"),
            [
                "https://docs.rs/*",
                "https://doc.rust-lang.org/*",
                "https://rust-analyzer.github.io/book/*",
                "https://rustc-dev-guide.rust-lang.org/*",
                "https://rust-lang.github.io/rustup/*",
                "https://microsoft.github.io/windows-docs-rs/doc/*",
                "https://en.wikipedia.org/*",
                "https://minecraft.wiki/*",
                "https://index.crates.io/*",
                "https://crates.io/api/v1/crates/*",
                "http://localhost:5173/api",
                "http://localhost:5173/api/*",
            ]);
    }

    /// New book hosts must not admit sibling projects or lookalike origins.
    #[test]
    fn book_url_scopes_reject_siblings_and_lookalikes() {
        for url in [
            "https://rust-analyzer.github.io/bookshop/",
            "https://rust-analyzer.github.io.example.com/book/",
            "https://rust-lang.github.io/other-project/",
            "https://rustc-dev-guide.rust-lang.org.example.com/",
        ] {
            assert!(!HOSTED_URL.iter().any(|prefix| url.starts_with(prefix)));
            assert!(!PROXIED_URL.iter().any(|prefix| url.starts_with(prefix)));
        }
    }

    #[test]
    fn release_api_filters_use_an_unmapped_origin() {
        let filters = web_resource_request_filters(RELEASE_API_ORIGIN);
        let expected_api_filters = [
            "https://api.turbodoc.example/api".to_owned(),
            "https://api.turbodoc.example/api/*".to_owned(),
        ];

        assert_eq!(
            (
                RELEASE_API_ORIGIN != RELEASE_FRONTEND_ORIGIN,
                &filters[PROXIED_URL.len()..]),
            (
                true,
                expected_api_filters.as_slice()));
    }
}
