<script lang="ts">
    import * as Resizable from "@shadcn/components/ui/resizable";

    import type { AppData } from "@/core/data";
    import * as storage from "@/core/localStorage";
    import * as ctx from "@/core/context.svelte";
    import * as IPC from "@/core/ipc";

    import Explorer from "@/ui/explorer/Explorer.svelte";

    /** Captured once at mount; the iframe's `src` is set from this on first
     *  render and never re-bound. All subsequent navigation goes through
     *  the `navigateTo` context callback below. */
    const initialUrl = storage.load("currentUrl");

    let appData: AppData | null = $state(null);
    let lastAppDataJson = "";

    // Load preset data once on mount. Defaults are applied lazily so a
    // fresh install renders with the Rust preset preselected.
    $effect(() => {
        IPC.loadPresetData()
            .then(loaded => {
                const data = (loaded ?? {}) as AppData;
                data.currentPreset ??= "Rust";
                data.presets ??= { "Rust": { providers: ["rust"] } };
                lastAppDataJson = JSON.stringify(data);
                appData = data;
            })
            .catch(err => console.error(err));
    });

    // Auto-save preset data on change. Tracks `appData` deeply via
    // JSON.stringify, which reads every nested property — Svelte's deep
    // proxy notices each one.
    $effect(() => {
        if (!appData) return;
        const json = JSON.stringify(appData);
        if (json === lastAppDataJson) return;
        lastAppDataJson = json;
        IPC.savePresetData(appData as object).catch(err => console.error(err));
    });

    // The WebView2 host posts a `navigated` IPC event when its iframe URL
    // changes. We persist the URL to localStorage; the storage event bus
    // propagates the change to every `currentUrl.value` reader.
    $effect(() => IPC.on("navigated", event => {
        // Filter the stray `storage-change-detection` ping fired when
        // localStorage values change in another browsing context.
        if (event.url === "https://docs.rs/-/storage-change-detection.html") return;
        storage.save("currentUrl", event.url);
    }));
</script>

{#if appData}
    <div class="w-full h-full flex flex-col">
        <div class="h-12">-</div>
        <Resizable.PaneGroup direction="horizontal">
            <Resizable.Pane defaultSize={20} class="px-2">
                <!-- Clip the explorer content with rounded corners. -->
                <div class="w-full h-full rounded-t-md overflow-clip">
                    <Explorer {appData} />
                </div>
            </Resizable.Pane>
            <Resizable.Handle class="w-0"/>
            <Resizable.Pane defaultSize={80}>
                <iframe
                    bind:this={ctx.viewerRef.value}
                    src={initialUrl}
                    title="Documentation viewer"
                    class="w-full h-full border border-white/30 rounded-tl-md"></iframe>
            </Resizable.Pane>
        </Resizable.PaneGroup>
    </div>
{/if}
