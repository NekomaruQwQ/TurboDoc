<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import * as Resizable from "@shadcn/components/ui/resizable";
    import { Button } from "@shadcn/components/ui/button";

    import * as ctx from "@/core/context.svelte";
    import type {
        DocumentNavigationCompleted,
        DocumentNavigationStarted,
    } from "@/core/host";
    import {
        type InitialDocumentLoadState,
        reduceInitialDocumentLoad,
    } from "@/core/documentLifecycle";
    import { ExplorerWorkspaceStore } from "@/core/explorerWorkspaceStore.svelte";
    import { SourceStoreRegistry } from "@/core/sourceStoreRegistry";
    import type { Topic } from "@/core/topic";
    import { findTopicForUrl, getTopicHomeUrl } from "@/core/topic";
    import {
        currentUrl,
        initializeUiState,
        setActiveTopicId,
    } from "@/core/uiState.svelte";
    import { migrateRustProviderV1 } from "@/migrations/rust-provider-v1";
    import topics from "@/topics";

    import WorkbenchToolbar from "./WorkbenchToolbar.svelte";
    import NavBar from "./NavBar.svelte";
    import Explorer from "./explorer/Explorer.svelte";

    const defaultTopic = topics[0];
    if (!defaultTopic) throw new Error("TurboDoc requires at least one topic.");
    const initialUiState = initializeUiState(topics);

    /** Captured once at mount and released only after the native host exposes
     * the workbench. Subsequent navigation goes through `ctx.navigateTo()`. */
    const initialUrl = initialUiState.currentUrl;
    const DOCUMENT_LOAD_TIMEOUT_MS = 30_000;
    let documentLoad = $state<InitialDocumentLoadState>({
        status: "waiting",
        url: initialUrl,
    });
    /** Latest accepted WebView2 navigation report. Keeping this ephemeral
     * signal separate from the persisted URL prevents unrelated storage or
     * source updates from moving the Explorer. */
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
        currentUrl.value = event.url;
        reportedNavigationId = event.navigationId;
        const owningTopic = findTopicForUrl(topics, event.url)?.topic;
        if (owningTopic) activateTopic(owningTopic, false);
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

    const workspace = new ExplorerWorkspaceStore();
    const sourceStores = new SourceStoreRegistry();
    let migrationStatus = $state<"loading" | "ready" | "error">("loading");
    let migrationError = $state<string | null>(null);
    let migrationAttempt: Promise<void> | undefined;
    let disposed = false;

    /** Run the removable Rust-only compatibility bridge before any new store
     * can initialize or persist its target resource. */
    function initializeWorkspace(): void {
        if (migrationAttempt || disposed) return;
        migrationStatus = "loading";
        migrationError = null;
        migrationAttempt = (async () => {
            try {
                await migrateRustProviderV1();
                if (disposed) return;
                await workspace.load();
                if (disposed) return;
                if (workspace.status === "ready")
                    workspace.reconcileTopics(topics.map(topic => topic.id));
                migrationStatus = "ready";
            } catch (error) {
                if (disposed) return;
                console.error("Legacy Rust migration failed:", error);
                migrationStatus = "error";
                migrationError = error instanceof Error ? error.message : String(error);
            }
        })().finally(() => migrationAttempt = undefined);
    }

    onMount(initializeWorkspace);

    onDestroy(() => {
        disposed = true;
        if (releaseFrame !== undefined) window.cancelAnimationFrame(releaseFrame);
        sourceStores.dispose();
        workspace.dispose();
    });

    // Deep JSON snapshotting inside the store makes every nested group edit a
    // dependency while the serialized queue prevents overlapping PUTs.
    $effect(() => workspace.autoSave());

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

    let topicId = $state(initialUiState.activeTopicId);
    let topic = $derived(topics.find(candidate => candidate.id === topicId) ?? defaultTopic);

    /** Persist a topic switch and optionally open its canonical landing
     * page. Navigation-reported switches keep the already accepted document. */
    function activateTopic(
        nextTopic: Topic,
        navigateHome: boolean): void {
        if (nextTopic.id === topicId) return;
        topicId = nextTopic.id;
        setActiveTopicId(nextTopic.id);
        if (navigateHome) ctx.navigateTo(getTopicHomeUrl(nextTopic));
    }

    /** Open a topic selected directly from the navigation rail. */
    function selectTopic(nextTopic: Topic): void {
        activateTopic(nextTopic, true);
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
                    {topics}
                    activeTopicId={topic.id}
                    onTopicSelect={selectTopic} />
                <section
                    class="explorer-pane"
                    aria-label="Documentation explorer">
                    {#if migrationStatus === "error"}
                        <div class="workspace-status" role="alert">
                            <span title={migrationError ?? undefined}>
                                Rust data migration failed. The old file was left unchanged.
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                onclick={initializeWorkspace}>
                                Retry
                            </Button>
                        </div>
                    {:else if migrationStatus === "ready" && workspace.status === "ready"}
                        <!-- Topic descendants capture UI grouping context at
                             initialization, so recreate this subtree only at
                             the topic ownership boundary. -->
                        {#key topic.id}
                            <Explorer
                                {topic}
                                {workspace}
                                {sourceStores}
                                {reportedNavigationId} />
                        {/key}
                    {:else if workspace.status === "error"}
                        <div class="workspace-status" role="alert">
                            <span>Explorer data failed to load.</span>
                            <Button
                                variant="ghost"
                                size="sm"
                                onclick={() => workspace.retryLoad()}>
                                Retry
                            </Button>
                        </div>
                    {:else}
                        <div class="workspace-status" role="status">
                            Loading Explorer…
                        </div>
                    {/if}
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

    .workspace-status {
        display: flex;
        min-height: 4rem;
        align-items: center;
        justify-content: center;
        gap: 0.25rem;
        padding: 0.75rem;
        color: var(--color-muted-foreground);
        font-size: 0.75rem;
        line-height: 1rem;
        text-align: center;
    }

    .workspace-status[role="alert"] { color: var(--color-destructive); }

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
