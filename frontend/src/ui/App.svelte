<script lang="ts">
    import * as Resizable from "@shadcn/components/ui/resizable";

    import * as storage from "@/core/localStorage";
    import * as ctx from "@/core/context.svelte";
    import * as IPC from "@/core/ipc";
    import providers from "@/providers";

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

<div class="w-full h-full flex flex-col gap-1">
    <div>-</div>
    <Resizable.PaneGroup direction="horizontal" class="gap-1">
        <div>
            <!-- Provider Switch Here -->
        </div>
        <Resizable.Pane
            defaultSize={20}
            class={
                "bg-sidebar w-full h-full " +
                "flex flex-col p-2 gap-1 " +
                "border rounded-t-xl overflow-y-scroll"}
            style="scrollbar-width: none">
            <Explorer {provider} />
        </Resizable.Pane>
        <Resizable.Handle class="w-0"/>
        <Resizable.Pane
            defaultSize={80}
            class="flex flex-col gap-2">
            <!-- Navigation Bar Here -->
            <!-- <div class="bg-sidebar h-12 rounded-xl">
            </div> -->
            <iframe
                bind:this={ctx.viewerRef.value}
                src={initialUrl}
                title="Documentation viewer"
                class="bg-sidebar w-full h-full border rounded-tl-xl">
            </iframe>
        </Resizable.Pane>
    </Resizable.PaneGroup>
</div>
