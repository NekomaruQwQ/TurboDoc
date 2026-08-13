import { mount } from "svelte";
import { installHostApi } from "@/core/host";
import App from "@/ui/App.svelte";

const app = mount(App, {
    // biome-ignore lint/style/noNonNullAssertion: element created in index.html.
    target: document.getElementById("app")!,
});

installHostApi({
    frontendShown: () => app.frontendShown(),
    documentNavigationStarted: report => app.documentNavigationStarted(report),
    documentNavigationCompleted: report => app.documentNavigationCompleted(report),
});
