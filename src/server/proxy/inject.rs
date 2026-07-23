//! Serve-time rustdoc dark-mode injection.
//!
//! WebView2 preserves the upstream origin for proxied requests, so the
//! rustdoc-theme `localStorage` key has to be set on each domain
//! individually. We do this by inlining a tiny `<script>` immediately after
//! the existing `<meta charset="UTF-8">`, matching the anchor the former
//! Bun server used (and matching the original WinUI implementation).
//!
//! Injection happens at *serve* time, not store time — that way a future
//! light/dark toggle could change the injected script without invalidating
//! the entire HTTP cache.

const RUSTDOC_PREFIXES: &[&str] = &[
    "https://docs.rs",
    "https://doc.rust-lang.org",
    "https://microsoft.github.io/windows-docs-rs/doc/",
];

const DARK_MODE_SCRIPT: &str =
    "<script>window.localStorage.setItem('rustdoc-theme','dark');</script>";

const ANCHOR: &str = r#"<meta charset="UTF-8">"#;

/// A buffered body and whether TurboDoc changed its representation bytes.
pub struct InjectedBody {
    pub bytes: Vec<u8>,
    pub modified: bool,
}

impl InjectedBody {
    fn unchanged(bytes: Vec<u8>) -> Self { Self { bytes, modified: false } }
}

/// If `(url, content_type)` identifies a rustdoc HTML page, inject the stable
/// dark-mode script into `body`.
///
/// The transform is deterministic: the same upstream bytes always produce the
/// same output bytes. Browser caching therefore follows upstream freshness.
/// Any future state-dependent or byte-changing injection must first revise the
/// downstream invalidation policy in `headers`.
pub fn dark_mode(url: &str, content_type: &str, body: Vec<u8>) -> InjectedBody {
    if !content_type.starts_with("text/html") { return InjectedBody::unchanged(body); }
    if !RUSTDOC_PREFIXES.iter().any(|p| url.starts_with(p)) {
        return InjectedBody::unchanged(body);
    }

    let html = match String::from_utf8(body) {
        Ok(s) => s,
        Err(err) => {
            log::warn!("[proxy] {url}: HTML body is not UTF-8, skipping dark mode injection");
            return InjectedBody::unchanged(err.into_bytes());
        },
    };
    if !html.contains(ANCHOR) {
        return InjectedBody::unchanged(html.into_bytes());
    }
    let injected =
        html.replacen(ANCHOR, &format!("{ANCHOR}{DARK_MODE_SCRIPT}"), 1);
    InjectedBody {
        bytes: injected.into_bytes(),
        modified: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injects_known_rustdoc_html_deterministically() {
        let body = format!("<html><head>{ANCHOR}</head></html>").into_bytes();
        let first = dark_mode("https://docs.rs/example/latest/example/", "text/html", body.clone());
        let second = dark_mode("https://docs.rs/example/latest/example/", "text/html", body);

        assert!(first.modified);
        assert_eq!(first.bytes, second.bytes);
        assert_eq!(
            String::from_utf8(first.bytes).expect("injected HTML remains UTF-8"),
            format!("<html><head>{ANCHOR}{DARK_MODE_SCRIPT}</head></html>"));
    }

    #[test]
    fn reports_unmodified_when_anchor_is_absent() {
        let original = b"<html><head></head></html>".to_vec();
        let result = dark_mode(
            "https://docs.rs/example/latest/example/",
            "text/html",
            original.clone());

        assert!(!result.modified);
        assert_eq!(result.bytes, original);
    }

    #[test]
    fn leaves_non_html_bodies_unmodified() {
        let original = b"body {}".to_vec();
        let result = dark_mode(
            "https://docs.rs/-/rustdoc.static/rustdoc.css",
            "text/css",
            original.clone());

        assert!(!result.modified);
        assert_eq!(result.bytes, original);
    }
}
