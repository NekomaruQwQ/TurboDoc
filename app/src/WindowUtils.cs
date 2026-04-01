using Windows.UI;

using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;

using static Vanara.PInvoke.User32;

namespace TurboDoc;

public static class WindowUtils {
    private static float GetDpiScalingFactorForWindow(nint hWnd) =>
        (float)GetDpiForWindow(hWnd) / 96;

    public static void ResizeClientInLogicalPixels(
        AppWindow window,
        int width,
        int height) {
        var scalingFactor =
            GetDpiScalingFactorForWindow(
                Win32Interop.GetWindowFromWindowId(window.Id));
        window.ResizeClient(new(
            (int)(scalingFactor * width),
            (int)(scalingFactor * height)));
    }

    private static Color GetColorFromBrushResource(string resourceKey) =>
        ((SolidColorBrush)Application.Current.Resources[resourceKey]).Color;

    // See `https://github.com/microsoft/WinUI-Gallery/blob/main/WinUIGallery/Helpers/TitleBarHelper.cs`.
    public static void SetColorForTitleBarButtons(AppWindowTitleBar titleBar) {
        // It seems that `titleBar.ButtonInactiveForegroundColor` should use the color
        // `GetColorFromBrushResource("TextFillColorTertiaryBrush");`, which resolves
        // to `#87FFFFFF` in dark theme, but it is actually rendered as `#FFFFFFFF`.
        //
        // Not sure if this is a WinUI bug or by design. Maybe we should premultiply
        // the alpha channel?

        titleBar.ButtonForegroundColor =
        titleBar.ButtonHoverForegroundColor =
        titleBar.ButtonInactiveForegroundColor =
            GetColorFromBrushResource("TextFillColorPrimaryBrush");
        titleBar.ButtonHoverBackgroundColor =
            GetColorFromBrushResource("ControlFillColorSecondaryBrush");
    }
}
