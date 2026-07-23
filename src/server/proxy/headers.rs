//! Response-header boundary between upstream documentation sites and
//! WebView2.
//!
//! TurboDoc buffers, caches, and sometimes transforms upstream bodies, so it
//! cannot safely relay every response field. This module keeps the small
//! browser-visible allowlist auditable and centralizes fields synthesized for
//! the final representation.

#[cfg(debug_assertions)]
use std::collections::HashSet;
#[cfg(debug_assertions)]
use std::sync::Mutex;
#[cfg(debug_assertions)]
use std::sync::OnceLock;

use http::HeaderMap;
use http::HeaderName;
use http::HeaderValue;
use http::StatusCode;

/// Whether TurboDoc should grant its localhost frontend public read access to
/// an intercepted cross-origin response.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CorsPolicy {
    /// Preserve the origin's CORS response without broadening it.
    PreserveUpstream,
    /// Synthesize wildcard access for public metadata when the origin omitted
    /// an `Access-Control-Allow-Origin` field.
    PublicFrontendRead,
}

/// Select the deliberate CORS exception for frontend-fetched public metadata.
///
/// Documentation documents and subresources keep their upstream CORS policy;
/// they are already same-origin from the iframe's perspective.
pub fn cors_policy_for(url: &str) -> CorsPolicy {
    const PUBLIC_FRONTEND_URLS: &[&str] = &[
        "https://index.crates.io/",
        "https://crates.io/api/v1/crates/",
    ];

    if PUBLIC_FRONTEND_URLS.iter().any(|prefix| url.starts_with(prefix)) {
        CorsPolicy::PublicFrontendRead
    } else {
        CorsPolicy::PreserveUpstream
    }
}

/// Keep only upstream fields that TurboDoc has explicitly reviewed for
/// WebView2 exposure.
///
/// The resulting map is safe to persist with a cache entry. Representation-
/// dependent removals and synthesized fields are applied later by
/// [`build_webview_headers`].
pub fn allowed_upstream_headers(upstream: &HeaderMap) -> HeaderMap {
    let mut allowed = HeaderMap::new();
    for (name, value) in upstream {
        if !is_allowed(name) {
            log_dropped_once(name);
            continue;
        }
        if value.to_str().is_err() {
            log::warn!("[proxy] dropping non-text response header `{name}`");
            continue;
        }
        allowed.append(name.clone(), value.clone());
    }
    allowed
}

/// Build the exact response fields exposed to WebView2.
///
/// `upstream` may be the original response map, cache-policy response parts,
/// or the allowed fields stored beside a stale cache entry. Applying the
/// allowlist again keeps every call path fail-closed.
pub fn build_webview_headers(
    upstream: &HeaderMap,
    status: StatusCode,
    body_len: Option<usize>,
    body_modified: bool,
    served_stale: bool,
    cors: CorsPolicy,
) -> HeaderMap {
    let mut result = allowed_upstream_headers(upstream);

    if !status.is_redirection() {
        result.remove(http::header::LOCATION);
    } else {
        // TurboDoc discards upstream redirect bodies, so representation
        // fields describing those bodies would be misleading.
        result.remove(http::header::CONTENT_TYPE);
        result.remove(http::header::CONTENT_LANGUAGE);
        result.remove(http::header::CONTENT_DISPOSITION);
    }

    if status != StatusCode::TOO_MANY_REQUESTS
        && status != StatusCode::SERVICE_UNAVAILABLE
    {
        result.remove(http::header::RETRY_AFTER);
    }

    if body_modified {
        // The stable dark-mode transform keeps upstream freshness and
        // Last-Modified semantics, but its bytes do not match a strong
        // upstream entity tag.
        result.remove(http::header::ETAG);
    }

    if served_stale {
        // Preserve upstream directives while making no-cache dominant. The
        // browser may store the body, but must return to TurboDoc before reuse.
        result.append(
            http::header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"));
    }

    if cors == CorsPolicy::PublicFrontendRead
        && !result.contains_key(http::header::ACCESS_CONTROL_ALLOW_ORIGIN)
    {
        result.insert(
            http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static("*"));
        // Wildcard origins and credentialed CORS are incompatible. Public
        // crate metadata does not need browser credentials.
        result.remove(http::header::ACCESS_CONTROL_ALLOW_CREDENTIALS);
    }

    if !status_has_no_body(status)
        && let Some(body_len) = body_len
    {
        result.insert(
            http::header::CONTENT_LENGTH,
            HeaderValue::from_str(&body_len.to_string())
                .expect("usize is a valid Content-Length"));
    }

    result
}

fn is_allowed(name: &HeaderName) -> bool {
    matches!(
        name.as_str(),
        "content-type"
            | "content-language"
            | "content-disposition"
            | "location"
            | "retry-after"
            | "cache-control"
            | "date"
            | "age"
            | "expires"
            | "etag"
            | "last-modified"
            | "vary"
            | "warning"
            | "access-control-allow-origin"
            | "access-control-allow-credentials"
            | "access-control-expose-headers"
            | "access-control-allow-methods"
            | "access-control-allow-headers"
            | "access-control-max-age"
            | "referrer-policy"
            | "x-content-type-options"
            | "permissions-policy"
            | "cross-origin-resource-policy"
            | "server-timing"
            | "timing-allow-origin")
}

fn status_has_no_body(status: StatusCode) -> bool {
    status.is_informational()
        || matches!(
            status,
            StatusCode::NO_CONTENT
                | StatusCode::RESET_CONTENT
                | StatusCode::NOT_MODIFIED)
}

/// Report unfamiliar response fields once in debug builds without logging
/// their potentially sensitive values.
fn log_dropped_once(name: &HeaderName) {
    #[cfg(debug_assertions)]
    {
        static DROPPED: OnceLock<Mutex<HashSet<HeaderName>>> = OnceLock::new();
        let dropped = DROPPED.get_or_init(|| Mutex::new(HashSet::new()));
        let mut dropped = dropped.lock().expect("dropped-header mutex poisoned");
        if dropped.insert(name.clone()) {
            log::debug!("[proxy] dropping response header `{name}`");
        }
    }

    #[cfg(not(debug_assertions))]
    let _ = name;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(fields: &[(&str, &str)]) -> HeaderMap {
        let mut result = HeaderMap::new();
        for (name, value) in fields {
            result.append(
                HeaderName::from_bytes(name.as_bytes()).expect("valid test header name"),
                HeaderValue::from_str(value).expect("valid test header value"));
        }
        result
    }

    #[test]
    fn keeps_every_reviewed_upstream_field() {
        let names = [
            "content-type",
            "content-language",
            "content-disposition",
            "location",
            "retry-after",
            "cache-control",
            "date",
            "age",
            "expires",
            "etag",
            "last-modified",
            "vary",
            "warning",
            "access-control-allow-origin",
            "access-control-allow-credentials",
            "access-control-expose-headers",
            "access-control-allow-methods",
            "access-control-allow-headers",
            "access-control-max-age",
            "referrer-policy",
            "x-content-type-options",
            "permissions-policy",
            "cross-origin-resource-policy",
            "server-timing",
            "timing-allow-origin",
        ];
        let fields =
            names
                .iter()
                .map(|name| (*name, "test-value"))
                .collect::<Vec<_>>();
        let headers = allowed_upstream_headers(&source(&fields));

        for name in names {
            assert!(headers.contains_key(name), "expected `{name}` to survive");
        }
    }

    #[test]
    fn preserves_repeated_allowed_values() {
        let headers = allowed_upstream_headers(&source(&[
            ("vary", "accept"),
            ("vary", "accept-language"),
        ]));

        assert_eq!(
            headers
                .get_all("vary")
                .iter()
                .map(|value| value.to_str().expect("text test header"))
                .collect::<Vec<_>>(),
            ["accept", "accept-language"]);
    }

    #[test]
    fn drops_every_documented_blocked_field() {
        let names = [
            "content-length",
            "connection",
            "keep-alive",
            "proxy-connection",
            "te",
            "trailer",
            "transfer-encoding",
            "upgrade",
            "alt-svc",
            "content-encoding",
            "accept-ranges",
            "content-range",
            "content-md5",
            "digest",
            "content-digest",
            "repr-digest",
            "content-location",
            "set-cookie",
            "set-cookie2",
            "clear-site-data",
            "strict-transport-security",
            "accept-ch",
            "critical-ch",
            "www-authenticate",
            "authentication-info",
            "proxy-authenticate",
            "proxy-authentication-info",
            "content-security-policy",
            "content-security-policy-report-only",
            "x-frame-options",
            "cross-origin-opener-policy",
            "cross-origin-embedder-policy",
            "origin-agent-cluster",
            "refresh",
            "link",
            "report-to",
            "reporting-endpoints",
            "nel",
            "expect-ct",
            "public-key-pins",
            "public-key-pins-report-only",
            "p3p",
            "server",
            "via",
            "x-powered-by",
            "x-cache",
            "x-cache-hits",
            "x-served-by",
            "x-future-header",
        ];
        let fields =
            names
                .iter()
                .map(|name| (*name, "test-value"))
                .collect::<Vec<_>>();
        let headers = allowed_upstream_headers(&source(&fields));

        for name in names {
            assert!(!headers.contains_key(name), "expected `{name}` to be blocked");
        }
    }

    #[test]
    fn injected_html_keeps_freshness_but_drops_strong_etag() {
        let headers = build_webview_headers(
            &source(&[
                ("content-type", "text/html"),
                ("cache-control", "public, max-age=600"),
                ("etag", "\"upstream\""),
                ("last-modified", "Wed, 22 Jul 2026 12:00:00 GMT"),
            ]),
            StatusCode::OK,
            Some(128),
            true,
            false,
            CorsPolicy::PreserveUpstream);

        assert_eq!(headers["cache-control"], "public, max-age=600");
        assert_eq!(headers["last-modified"], "Wed, 22 Jul 2026 12:00:00 GMT");
        assert_eq!(headers["content-length"], "128");
        assert!(!headers.contains_key("etag"));
    }

    #[test]
    fn stale_response_requires_browser_revalidation() {
        let headers = build_webview_headers(
            &source(&[("cache-control", "public, max-age=31536000, immutable")]),
            StatusCode::OK,
            Some(4),
            false,
            true,
            CorsPolicy::PreserveUpstream);

        assert_eq!(
            headers
                .get_all("cache-control")
                .iter()
                .map(|value| value.to_str().expect("text test header"))
                .collect::<Vec<_>>(),
            ["public, max-age=31536000, immutable", "no-cache"]);
    }

    #[test]
    fn untouched_body_keeps_upstream_etag() {
        let headers = build_webview_headers(
            &source(&[("etag", "\"upstream\"")]),
            StatusCode::OK,
            Some(4),
            false,
            false,
            CorsPolicy::PreserveUpstream);

        assert_eq!(headers["etag"], "\"upstream\"");
    }

    #[test]
    fn public_metadata_gets_noncredentialed_wildcard_cors() {
        let headers = build_webview_headers(
            &source(&[("access-control-allow-credentials", "true")]),
            StatusCode::OK,
            Some(4),
            false,
            false,
            CorsPolicy::PublicFrontendRead);

        assert_eq!(headers["access-control-allow-origin"], "*");
        assert!(!headers.contains_key("access-control-allow-credentials"));
    }

    #[test]
    fn upstream_cors_is_not_overwritten() {
        let headers = build_webview_headers(
            &source(&[
                ("access-control-allow-origin", "https://example.test"),
                ("access-control-allow-credentials", "true"),
            ]),
            StatusCode::OK,
            Some(4),
            false,
            false,
            CorsPolicy::PublicFrontendRead);

        assert_eq!(headers["access-control-allow-origin"], "https://example.test");
        assert_eq!(headers["access-control-allow-credentials"], "true");
    }

    #[test]
    fn redirect_keeps_location_and_discards_body_metadata() {
        let headers = build_webview_headers(
            &source(&[
                ("location", "/target"),
                ("content-type", "text/html"),
                ("cache-control", "public, max-age=60"),
            ]),
            StatusCode::FOUND,
            None,
            false,
            false,
            CorsPolicy::PreserveUpstream);

        assert_eq!(headers["location"], "/target");
        assert_eq!(headers["cache-control"], "public, max-age=60");
        assert!(!headers.contains_key("content-type"));
        assert!(!headers.contains_key("content-length"));
    }

    #[test]
    fn no_body_status_omits_content_length() {
        let headers = build_webview_headers(
            &HeaderMap::new(),
            StatusCode::NOT_MODIFIED,
            Some(123),
            false,
            false,
            CorsPolicy::PreserveUpstream);

        assert!(!headers.contains_key("content-length"));
    }

    #[test]
    fn cors_policy_is_scoped_to_public_metadata() {
        assert_eq!(
            cors_policy_for("https://index.crates.io/to/ki/tokio"),
            CorsPolicy::PublicFrontendRead);
        assert_eq!(
            cors_policy_for("https://crates.io/api/v1/crates/tokio"),
            CorsPolicy::PublicFrontendRead);
        assert_eq!(
            cors_policy_for("https://docs.rs/tokio/latest/tokio/"),
            CorsPolicy::PreserveUpstream);
    }
}
