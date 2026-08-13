<script lang="ts">
    import { onDestroy } from "svelte";
    import * as Resizable from "@shadcn/components/ui/resizable";
    import { Button } from "@shadcn/components/ui/button";

    import * as storage from "@/core/localStorage";
    import * as ctx from "@/core/context.svelte";
    import type {
        DocumentNavigationCompleted,
        DocumentNavigationStarted,
    } from "@/core/host";
    import {
        type InitialDocumentLoadState,
        reduceInitialDocumentLoad,
    } from "@/core/documentLifecycle";
    import providers from "@/providers";

    import WorkbenchToolbar from "./WorkbenchToolbar.svelte";
    import Explorer from "./explorer/Explorer.svelte";

    /** Captured once at mount and released only after the native host exposes
     * the workbench. Subsequent navigation goes through `ctx.navigateTo()`. */
    const initialUrl = storage.load("currentUrl");
    const DOCUMENT_LOAD_TIMEOUT_MS = 30_000;
    let documentLoad = $state<InitialDocumentLoadState>({
        status: "waiting",
        url: initialUrl,
    });
    /** Latest accepted WebView2 navigation report. Keeping this ephemeral
     * signal separate from the persisted URL prevents unrelated storage or
     * provider updates from moving the Explorer. */
    let reportedNavigationId = $state<string | null>(null);
    let releaseFrame: number | undefined;

    /** Persist an accepted frame navigation and correlate the initial loading
     * placeholder with its WebView2 navigation ID. */
    export function documentNavigationStarted(
        event: DocumentNavigationStarted,
    ): void {
        // Filter the stray `storage-change-detection` ping fired when
        // localStorage values change in another browsing context.
        if (event.url === "https://docs.rs/-/storage-change-detection.html") return;
        storage.save("currentUrl", event.url);
        reportedNavigationId = event.navigationId;
        documentLoad = reduceInitialDocumentLoad(documentLoad, {
            type: "started",
            url: event.url,
            navigationId: event.navigationId,
        });
    }

    /** Settle the placeholder only when the completion belongs to the latest
     * accepted iframe navigation. */
    export function documentNavigationCompleted(
        event: DocumentNavigationCompleted,
    ): void {
        documentLoad = reduceInitialDocumentLoad(documentLoad, {
            type: "completed",
            navigationId: event.navigationId,
            success: event.success,
            error: event.error,
        });
    }

    /** Begin documentation loading one paint opportunity after the native
     * controller becomes visible. Duplicate host reports are ignored. */
    export function frontendShown(): void {
        if (documentLoad.status !== "waiting") return;
        documentLoad = reduceInitialDocumentLoad(documentLoad, { type: "released" });
        releaseFrame = window.requestAnimationFrame(() => {
            releaseFrame = undefined;
            ctx.releaseViewerNavigation(initialUrl);
        });
    }

    /** Retry the URL retained by the initial-load failure state. */
    function retryDocumentNavigation(): void {
        if (documentLoad.status !== "error") return;
        const url = documentLoad.url;
        documentLoad = reduceInitialDocumentLoad(documentLoad, { type: "retry" });
        ctx.navigateTo(url);
    }

    onDestroy(() => {
        if (releaseFrame !== undefined) window.cancelAnimationFrame(releaseFrame);
    });

    // Documentation failure is local to the editor pane; unlike frontend
    // startup failure it must not hide the otherwise usable workbench.
    $effect(() => {
        if (documentLoad.status !== "loading") return;
        const timeout = window.setTimeout(() => {
            documentLoad = reduceInitialDocumentLoad(
                documentLoad,
                { type: "timed-out" });
        }, DOCUMENT_LOAD_TIMEOUT_MS);
        return () => window.clearTimeout(timeout);
    });

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
                <Explorer {provider} {reportedNavigationId} />
            </section>
        </Resizable.Pane>
        <Resizable.Handle
            class="w-1 bg-transparent transition-colors after:w-2 hover:bg-ring/35 focus-visible:bg-ring/45" />
        <Resizable.Pane defaultSize={80} class="flex min-w-0 flex-col">
            <div
                class="relative min-h-0 flex-1"
                aria-busy={documentLoad.status !== "ready"}>
                <iframe
                    bind:this={ctx.viewerRef.value}
                    title="Documentation viewer"
                    class="h-full w-full rounded-lg border border-workbench-divider bg-editor">
                </iframe>
                {#if documentLoad.status !== "ready"}
                    <div
                        role={documentLoad.status === "error" ? "alert" : "status"}
                        aria-live="polite"
                        class="absolute inset-0 flex items-center justify-center rounded-lg border border-workbench-divider bg-editor">
                        {#if documentLoad.status === "error"}
                            <div class="flex max-w-sm flex-col items-center px-8 text-center">
                                <p class="text-sm font-medium text-foreground">
                                    Documentation didn’t load
                                </p>
                                <p class="mt-1.5 text-xs leading-5 text-muted-foreground">
                                    {documentLoad.reason === "timeout"
                                        ? "The page is taking too long to respond."
                                        : "The page could not be loaded. Check the connection and try again."}
                                </p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    class="mt-4"
                                    onclick={retryDocumentNavigation}>
                                    Retry
                                </Button>
                            </div>
                        {:else}
                            <div class="flex flex-col items-center text-muted-foreground">
                                <span
                                    aria-hidden="true"
                                    class="size-5 animate-spin rounded-full border-2 border-current/20 border-t-primary motion-reduce:animate-none">
                                </span>
                                <p class="mt-3 text-xs">Loading documentation…</p>
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        </Resizable.Pane>
    </Resizable.PaneGroup>
</div>
