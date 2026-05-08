import { mount } from "svelte";
import App from "@/ui/App.svelte";

mount(App, {
    // biome-ignore lint/style/noNonNullAssertion: element created in index.html.
    target: document.getElementById("app")!,
});
