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

/// If `(url, content_type)` identifies a rustdoc HTML page, inject the dark
/// mode script into `body`. Otherwise return `body` unchanged.
pub fn dark_mode(url: &str, content_type: &str, body: Vec<u8>) -> Vec<u8> {
    if !content_type.starts_with("text/html") { return body; }
    if !RUSTDOC_PREFIXES.iter().any(|p| url.starts_with(p)) { return body; }

    let html = match String::from_utf8(body) {
        Ok(s) => s,
        Err(err) => {
            log::warn!("[proxy] {url}: HTML body is not UTF-8, skipping dark mode injection");
            return err.into_bytes();
        },
    };
    let injected =
        html.replacen(ANCHOR, &format!("{ANCHOR}{DARK_MODE_SCRIPT}"), 1);
    injected.into_bytes()
}
