using Microsoft.UI.Windowing;

namespace TurboDoc;

public sealed partial class MainWindow {
    public MainWindow() {
        this.InitializeComponent();

        this.ExtendsContentIntoTitleBar = true;
        this.AppWindow
            .TitleBar
            .PreferredHeightOption = TitleBarHeightOption.Tall;
        this.SetTitleBar(this.TitleBar);

        WindowUtils.SetThemeForTitleBarButtons(this);
        WindowUtils.ResizeClientInLogicalPixels(
            this.AppWindow,
            1280,
            800);
    }
}
