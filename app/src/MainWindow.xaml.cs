using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Text;

using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;

using static Vanara.PInvoke.User32;

namespace TurboDoc;

[SuppressMessage("ReSharper", "AsyncVoidMethod")]
public sealed partial class MainWindow {
    /// Server URL derived from the `TURBODOC_PORT` environment variable.
    /// Validated at startup in the constructor — if unset, the app exits with an error.
    private static readonly string ServerUrl =
        Environment.GetEnvironmentVariable("TURBODOC_PORT") is { } port
            ? $"http://localhost:{port}/"
            : null!;

    /// URL prefixes for documentation domains that the host proxies and tracks.
    private static readonly string[] ProxiedUrls = [
        "https://docs.rs/",
        "https://doc.rust-lang.org/",
        "https://microsoft.github.io/windows-docs-rs/doc/",
    ];

    /// Shared HTTP client for forwarding intercepted requests to the Hono proxy.
    /// Auto-redirect is disabled so 3xx responses pass through to WebView2,
    /// which re-navigates and re-triggers interception for the redirected URL.
    private static readonly HttpClient ProxyClient = new(
        new HttpClientHandler() {
            AllowAutoRedirect = false,
        });

    public MainWindow() {
        if (ServerUrl is null) {
            MessageBox(
                lpCaption: "TurboDoc",
                lpText: "TURBODOC_PORT environment variable is required to start the app.",
                uType: MB_FLAGS.MB_ICONERROR);
            Application.Current.Exit();
            return;
        }

        this.InitializeComponent();

        this.ExtendsContentIntoTitleBar = true;
        this.AppWindow
            .TitleBar
            .PreferredHeightOption = TitleBarHeightOption.Tall;
        this.SetTitleBar(this.TitleBar);

        WindowUtils.SetColorForTitleBarButtons(
            this.AppWindow.TitleBar);
        WindowUtils.ResizeClientInLogicalPixels(
            this.AppWindow,
            1280,
            800);

        this.WebView2.Visibility = Visibility.Collapsed;
        this.InitializeWebViewAsync();
    }

    /// Initializes WebView2, sets up event handlers, and navigates to the frontend.
    private async void InitializeWebViewAsync() {
        await this.WebView2.EnsureCoreWebView2Async();

        var core = this.WebView2.CoreWebView2;

        // We would like to intercept all web resource requests, so we add an `*` filter here.
        // This is not necessary for general usage.
        //
        // Note that we need to use `AddWebResourceRequestedFilterWithRequestSourceKinds`
        // and specify `COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_DOCUMENT` to cover
        // requests from `<iframe>` elements as well.
        //
        // See https://github.com/MicrosoftEdge/WebView2Feedback/issues/2341#issuecomment-1332463257
        // for more details on intercepting requests from `<iframe>`.
        core.AddWebResourceRequestedFilter(
            "*",
            CoreWebView2WebResourceContext.All,
            CoreWebView2WebResourceRequestSourceKinds.Document);

        core.NavigationCompleted
            += OnFirstNavigationCompleted;
        core.FrameNavigationStarting
            += OnFrameNavigationStarting;
        core.WebResourceRequested
            += OnWebResourceRequested;

        core.Navigate(ServerUrl);
    }

    // == Event Handlers ==

    /// One-shot handler: unsubscribes itself after the frontend's first load.
    /// Throws on failure because a broken frontend is unrecoverable.
    private void OnFirstNavigationCompleted(
        CoreWebView2 sender,
        CoreWebView2NavigationCompletedEventArgs e) {
        sender.NavigationCompleted -= this.OnFirstNavigationCompleted;

        if (e.IsSuccess) {
            this.WebView2.Visibility = Visibility.Visible;
        } else {
            var errorMessage =
                "Failed to load the TurboDoc frontend. " +
                $"Please ensure the TurboDoc server is running at {ServerUrl}.";
            MessageBox(
                lpCaption: "TurboDoc",
                lpText: errorMessage,
                uType: MB_FLAGS.MB_ICONERROR);
            Application.Current.Exit();
        }
    }

    /// Intercepts iframe navigations (documentation page links).
    ///
    /// - External URLs: cancel navigation and offer to open in the system browser.
    /// - Known documentation URLs: forward a `navigated` event to the frontend
    ///   so it can update the sidebar (version selector, current item highlight).
    /// - Ignored URLs (e.g. `docs.rs/-/`): let navigation proceed silently.
    private static void OnFrameNavigationStarting(
        CoreWebView2 sender,
        CoreWebView2NavigationStartingEventArgs e) {
        var url = e.Uri;

        if (ProxiedUrls.Any(url.StartsWith)) {
            sender.PostWebMessageAsJson($$"""{"type":"navigated","url":"{{url}}"}""");
        } else {
            e.Cancel = true;

            const string msgBoxTitle =
                "Open External URL";
            const string msgBoxContent =
                "Do you want to open this link in your default web browser?";

            var result =
                MessageBox(
                    lpCaption: msgBoxTitle,
                    lpText: msgBoxContent + "\n\n" + url,
                    uType: MB_FLAGS.MB_OKCANCEL | MB_FLAGS.MB_ICONQUESTION);
            if (result == MB_RESULT.IDOK) {
                Process.Start(new ProcessStartInfo(url) {
                    UseShellExecute = true,
                });
            }
        }
    }

    /// Proxies GET requests for known doc URLs through the Hono server's
    /// `/proxy?url=` endpoint, which handles upstream fetching, RFC 7234
    /// caching, and dark mode injection.
    private static async void OnWebResourceRequested(
        CoreWebView2 sender,
        CoreWebView2WebResourceRequestedEventArgs e) {
        var uri = e.Request.Uri;
        if (e.Request.Method != "GET" || !ProxiedUrls.Any(uri.StartsWith)) return;

        var deferral = e.GetDeferral();
        try {
            var proxyUrl = $"{ServerUrl}proxy?url={Uri.EscapeDataString(uri)}";
            var response = await ProxyClient.GetAsync(proxyUrl);
            var body = await response.Content.ReadAsStreamAsync();
            var headers = FormatResponseHeaders(response);

            e.Response = sender.Environment.CreateWebResourceResponse(
                body.AsRandomAccessStream(),
                (int)response.StatusCode,
                response.ReasonPhrase ?? "OK",
                headers);
        } catch (Exception ex) {
            Debug.WriteLine($"[proxy] {uri}: {ex.Message}");
        } finally {
            deferral.Complete();
        }
    }

    /// Formats HTTP response headers into the `"name: value\r\n"` string that
    /// `CreateWebResourceResponse` expects.
    private static string FormatResponseHeaders(HttpResponseMessage response) {
        var stringBuilder = new StringBuilder();

        foreach (var (key, values) in response.Headers) {
            foreach (var value in values)
                stringBuilder
                    .Append(key)
                    .Append(": ")
                    .Append(value)
                    .Append("\r\n");
        }

        foreach (var (key, values) in response.Content.Headers) {
            foreach (var value in values)
                stringBuilder
                    .Append(key)
                    .Append(": ")
                    .Append(value)
                    .Append("\r\n");
        }

        return stringBuilder.ToString();
    }
}
