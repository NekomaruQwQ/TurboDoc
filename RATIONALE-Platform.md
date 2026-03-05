# Platform Rationale: Windows + WebView2

## The Core Requirement

TurboDoc's architecture depends on a **transparent HTTPS proxy** embedded in the webview layer. The app's iframe browses documentation sites (docs.rs, doc.rust-lang.org) as if it were a normal browser, while the host silently intercepts every request and routes it through a local Bun server for caching and dark mode injection.

This requires two capabilities from the webview:

1. **Transparent HTTPS request interception** — intercept any outgoing HTTPS request from the iframe *before* it reaches the network, and replace the response with one from the local proxy. The page must not know this happened: `window.location`, CORS origins, and relative URLs all stay on the original domain.

2. **Iframe navigation detection** — detect when the iframe navigates to a new URL so the sidebar can update, auto-import unknown crates, and sync the version selector.

## Why WebView2

WebView2 (the Chromium-based webview component shipped with Windows) provides both capabilities as first-class APIs:

- **`AddWebResourceRequestedFilter` + `WebResourceRequested`** — registers a URL pattern filter and fires a callback before matching requests hit the network. The handler can replace the response entirely (status, headers, body) while the page sees the original URL. This is the foundation of the "dumb pipe" proxy architecture: the C# host intercepts doc URL requests and forwards them to the Bun server's `/proxy?url=` endpoint.

- **`FrameNavigationStarting`** — fires specifically for iframe navigations (not just top-level). The host posts a `navigated` event to the frontend via `PostWebMessageAsJson`, which triggers sidebar updates.

WebView2 is **pre-installed on every Windows 10 (April 2018+) and Windows 11 machine** via Windows Update. The app ships no embedded browser — the runtime overhead is the C# host alone.

## Why Not Electron

Electron *can* do everything TurboDoc needs. Its `webRequest` API intercepts HTTP/HTTPS requests, and `did-frame-navigate` detects iframe navigations. It's a viable technical choice.

The trade-offs:

- **Bundle size**: Electron ships a full Chromium build (~150 MB compressed). WebView2 is already on the system — TurboDoc's host binary is under 5 MB.
- **Two JS runtimes**: TurboDoc's server runs on Bun. Electron brings Node.js as its main process runtime, meaning two JavaScript engines in one app.
- **Update burden**: Electron apps must ship Chromium security updates themselves. WebView2 updates via Windows Update automatically.

Electron remains the most likely path to cross-platform support if that becomes a goal.

## Why Not Tauri

Tauri is a compelling framework for lightweight desktop apps, but its cross-platform promise breaks down for TurboDoc's use case.

Tauri uses the **system webview** on each platform:
- **Windows**: WebView2 — same engine as our current host, full request interception works
- **macOS**: WKWebView — supports `WKURLSchemeHandler` for custom URL schemes only (e.g., `app://`), but **cannot intercept `https://` requests**. There is no API to transparently replace responses for standard HTTPS URLs.
- **Linux**: WebKitGTK — similar limitations to WKWebView. No transparent HTTPS interception for arbitrary domains.

Since TurboDoc's iframe must believe it is browsing `https://docs.rs` directly (not a custom scheme), Tauri on macOS and Linux cannot support the proxy architecture. The app would be "cross-platform" in packaging only — the core caching and dark mode features would not work on two of three platforms.

## Future: Cross-Platform Support

If cross-platform becomes a priority, the options are:

1. **Electron fallback** — replace the C# host with Electron. Gains macOS + Linux at the cost of bundle size and dual runtimes. The Bun server and React frontend are already platform-agnostic.

2. **Degraded mode** — on platforms without request interception, skip the proxy layer. The iframe fetches docs directly from the internet. No offline caching, no dark mode injection, but the sidebar, pinning, and organization features still work. This could be combined with a service worker for partial caching.

3. **Chromium Embedded Framework (CEF)** — provides the same interception APIs as WebView2 across all platforms, but requires bundling Chromium (similar trade-off to Electron).

For now, Windows + WebView2 delivers the full feature set with minimal overhead, and the architecture cleanly separates the host (C# shell) from the logic (Bun server + React frontend), making a future host swap straightforward.
