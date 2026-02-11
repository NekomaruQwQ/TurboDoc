using Microsoft.UI.Xaml;

namespace TurboDoc;

public partial class App {
    private Window? _window;

    public App() {
        this.InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args) {
        this._window = new MainWindow();
    }
}
