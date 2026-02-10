using System.Runtime.InteropServices;

using Windows.UI;

using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;

namespace TurboDoc;

public static partial class PInvoke {
    [LibraryImport("user32.dll", SetLastError = true)]
    public static partial uint GetDpiForWindow(nint hWnd);
}

public static class WindowUtils {
    private static float GetDpiScalingFactorForWindow(nint hWnd) =>
        (float)PInvoke.GetDpiForWindow(hWnd) / 96;

    public static void ResizeClientInLogicalPixels(
        AppWindow window,
        int width,
        int height) {
        var scalingFactor =
            GetDpiScalingFactorForWindow(
                Win32Interop.GetWindowFromWindowId(window.Id));
        window.ResizeClient(new(
            (int)(width * scalingFactor),
            (int)(height * scalingFactor)));
    }

    private static Color GetColorFromBrushResource(string resourceKey) =>
        ((SolidColorBrush)Application.Current.Resources[resourceKey]).Color;

    // See `https://github.com/microsoft/WinUI-Gallery/blob/main/WinUIGallery/Helpers/TitleBarHelper.cs`.
    public static void SetThemeForTitleBarButtons(Window window) {
        var titleBar = window.AppWindow.TitleBar;

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
