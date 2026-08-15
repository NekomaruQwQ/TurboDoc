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
    import type { Provider } from "@/core/data";
    import providers from "@/providers";

    import WorkbenchToolbar from "./WorkbenchToolbar.svelte";
    import NavBar from "./NavBar.svelte";
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

    /** Restore only registered providers. Removed or corrupt IDs fall back to
     * the registry default and are repaired immediately for the next launch. */
    const storedProviderId = storage.load("activeProviderId");
    const initialProviderId = providers.some(provider => provider.id === storedProviderId)
        ? storedProviderId
        : providers[0].id;
    if (storedProviderId !== initialProviderId)
        storage.save("activeProviderId", initialProviderId);

    let providerId = $state(initialProviderId);
    let provider = $derived(providers.find(p => p.id === providerId) ?? providers[0]);

    /** Persist an explicit provider switch and open its canonical landing
     * page. Reselecting the active provider intentionally does not reload it. */
    function selectProvider(nextProvider: Provider): void {
        if (nextProvider.id === providerId) return;
        providerId = nextProvider.id;
        storage.save("activeProviderId", nextProvider.id);
        ctx.navigateTo(nextProvider.homeUrl);
    }
</script>

<div class="workbench">
    <WorkbenchToolbar />
    <Resizable.PaneGroup direction="horizontal" class="workbench-pane-group">
        <Resizable.Pane defaultSize={24} class="workbench-sidebar-pane">
            <aside
                class="sidebar"
                aria-label="Documentation sidebar">
                <NavBar
                    {providers}
                    activeProviderId={provider.id}
                    onProviderSelect={selectProvider} />
                <section
                    class="explorer-pane"
                    aria-label="Documentation explorer">
                    <Explorer {provider} {reportedNavigationId} />
                </section>
            </aside>
        </Resizable.Pane>
        <Resizable.Handle
            class="workbench-resize-handle" />
        <Resizable.Pane defaultSize={80} class="workbench-editor-pane">
            <div
                class="editor-pane"
                aria-busy={documentLoad.status !== "ready"}>
                <iframe
                    bind:this={ctx.viewerRef.value}
                    title="Documentation viewer"
                    class="document-viewer">
                </iframe>
                {#if documentLoad.status !== "ready"}
                    <div
                        role={documentLoad.status === "error" ? "alert" : "status"}
                        aria-live="polite"
                        class="document-placeholder">
                        {#if documentLoad.status === "error"}
                            <div class="document-error">
                                <p class="document-error-title">
                                    Documentation didn’t load
                                </p>
                                <p class="document-error-message">
                                    {documentLoad.reason === "timeout"
                                        ? "The page is taking too long to respond."
                                        : "The page could not be loaded. Check the connection and try again."}
                                </p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    class="workbench-retry-action"
                                    onclick={retryDocumentNavigation}>
                                    Retry
                                </Button>
                            </div>
                        {:else}
                            <div class="document-loading">
                                <span
                                    aria-hidden="true"
                                    class="document-spinner">
                                </span>
                                <p class="document-loading-label">Loading documentation…</p>
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        </Resizable.Pane>
    </Resizable.PaneGroup>
</div>

<style>
    .workbench {
        display: flex;
        width: 100%;
        height: 100%;
        flex-direction: column;
        background-color: var(--color-workbench);
    }

    :global(.workbench-pane-group) {
        min-height: 0;
        flex: 1 1 0%;
        gap: 0.125rem;
        padding: 0.5rem;
    }

    :global(.workbench-sidebar-pane),
    :global(.workbench-editor-pane) {
        display: flex;
        min-width: 0;
        flex-direction: column;
    }

    .sidebar {
        display: flex;
        min-height: 0;
        flex: 1 1 0%;
        overflow: hidden;
        border: 1px solid var(--color-workbench-divider);
        border-radius: var(--radius-lg);
        background-color: var(--color-sidebar);
    }

    .explorer-pane {
        display: flex;
        min-width: 0;
        flex: 1 1 0%;
        flex-direction: column;
    }

    :global(.workbench-resize-handle) {
        width: 0.25rem;
        background-color: transparent;
        transition: background-color 150ms;
    }

    :global(.workbench-resize-handle::after) {
        width: 0.5rem;
    }

    :global(.workbench-resize-handle:hover) {
        background-color: color-mix(in oklab, var(--color-ring) 35%, transparent);
    }

    :global(.workbench-resize-handle:focus-visible) {
        background-color: color-mix(in oklab, var(--color-ring) 45%, transparent);
    }

    .editor-pane {
        position: relative;
        min-height: 0;
        flex: 1 1 0%;
    }

    .document-viewer,
    .document-placeholder {
        border: 1px solid var(--color-workbench-divider);
        border-radius: var(--radius-lg);
        background-color: var(--color-editor);
    }

    .document-viewer {
        width: 100%;
        height: 100%;
    }

    .document-placeholder {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .document-error {
        display: flex;
        max-width: 24rem;
        flex-direction: column;
        align-items: center;
        padding-inline: 2rem;
        text-align: center;
    }

    .document-error-title {
        color: var(--color-foreground);
        font-size: 0.875rem;
        font-weight: 500;
    }

    .document-error-message {
        margin-top: 0.375rem;
        color: var(--color-muted-foreground);
        font-size: 0.75rem;
        line-height: 1.25rem;
    }

    :global([data-slot="button"].workbench-retry-action) {
        margin-top: 1rem;
    }

    .document-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        color: var(--color-muted-foreground);
    }

    .document-spinner {
        width: 1.25rem;
        height: 1.25rem;
        border: 2px solid color-mix(in oklab, currentcolor 20%, transparent);
        border-top-color: var(--color-primary);
        border-radius: 9999px;
        animation: document-spinner 1s linear infinite;
    }

    .document-loading-label {
        margin-top: 0.75rem;
        font-size: 0.75rem;
    }

    @keyframes document-spinner {
        to { transform: rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
        .document-spinner { animation: none; }
    }
</style>
