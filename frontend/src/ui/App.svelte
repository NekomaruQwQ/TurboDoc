<script lang="ts">
    import * as Resizable from "@shadcn/components/ui/resizable";

    import * as storage from "@/core/localStorage";
    import * as ctx from "@/core/context.svelte";
    import * as IPC from "@/core/ipc";
    import providers from "@/providers";

    import WorkbenchToolbar from "./WorkbenchToolbar.svelte";
    import Explorer from "./explorer/Explorer.svelte";

    /** Captured once at mount; the iframe's `src` is set from this on first
     *  render and never re-bound. All subsequent navigation goes through
     *  the `navigateTo` context callback below. */
    const initialUrl = storage.load("currentUrl");

    // The WebView2 host posts a `navigated` IPC event when its iframe URL
    // changes. We persist the URL to localStorage; the storage event bus
    // propagates the change to every `currentUrl.value` reader.
    $effect(() => IPC.on("navigated", event => {
        // Filter the stray `storage-change-detection` ping fired when
        // localStorage values change in another browsing context.
        if (event.url === "https://docs.rs/-/storage-change-detection.html") return;
        storage.save("currentUrl", event.url);
    }));

    let providerId = $state(providers[0].id);
    let provider = $derived(providers.find(p => p.id === providerId) ?? providers[0]);
</script>

<div class="flex h-full w-full flex-col bg-workbench">
    <WorkbenchToolbar />
    <Resizable.PaneGroup direction="horizontal" class="min-h-0 flex-1 gap-0.5 p-2">
        <Resizable.Pane defaultSize={20} class="flex min-w-0 flex-col">
            <section
                class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-workbench-divider bg-sidebar"
                aria-label="Documentation explorer">
                <Explorer {provider} />
            </section>
        </Resizable.Pane>
        <Resizable.Handle
            class="w-1 bg-transparent transition-colors after:w-2 hover:bg-ring/35 focus-visible:bg-ring/45" />
        <Resizable.Pane defaultSize={80} class="flex min-w-0 flex-col">
            <iframe
                bind:this={ctx.viewerRef.value}
                src={initialUrl}
                title="Documentation viewer"
                class="h-full w-full rounded-lg border border-workbench-divider bg-editor">
            </iframe>
        </Resizable.Pane>
    </Resizable.PaneGroup>
</div>
