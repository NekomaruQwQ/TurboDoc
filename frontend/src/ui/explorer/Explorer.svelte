<script lang="ts">
    import { onDestroy, tick, untrack } from "svelte";
    import { Button } from "@shadcn/components/ui/button";

    import * as ctx from "@/core/context.svelte";
    import type { ExplorerWorkspaceStore } from "@/core/explorerWorkspaceStore.svelte";
    import type { ItemKey } from "@/core/itemKey";
    import type { SourceDataStore } from "@/core/sourceDataStore.svelte";
    import type { SourceStoreRegistry } from "@/core/sourceStoreRegistry";
    import type { SourceModel, SourceModelContext } from "@/core/source";
    import { composeTopicView, type ReadySourceView, type Topic } from "@/core/topic";
    import {
        currentUrl,
        expandGroup,
        expandItems,
        reconcileTopicUiState,
        recentlyAccessedItemIds,
        recordItemAccess,
    } from "@/core/uiState.svelte";

    import ExplorerGroup from "@/ui/explorer/ExplorerGroup.svelte";
    import ExplorerCreateGroupComponent from "@/ui/explorer/ExplorerCreateGroupComponent.svelte";
    import ExplorerSearch from "@/ui/explorer/ExplorerSearch.svelte";
    import InputActionDialog from "@/ui/explorer/InputActionDialog.svelte";
    import {
        calculateExplorerRevealScrollTop,
        DEFAULT_EXPLORER_CENTER_RANGE,
        type ExplorerCenterRange,
    } from "@/ui/explorer/reveal";

    let {
        topic,
        workspace,
        sourceStores,
        reportedNavigationId,
        centerRange = DEFAULT_EXPLORER_CENTER_RANGE,
    }: {
        /** UI-only topic whose ready sources are composed here. */
        topic: Topic;
        /** App-owned group workspace shared across topic switches. */
        workspace: ExplorerWorkspaceStore;
        /** App-owned lazy source stores that outlive this keyed topic view. */
        sourceStores: SourceStoreRegistry;
        /** Latest accepted host navigation, separate from persisted URL. */
        reportedNavigationId: string | null;
        /** Fractional viewport band used to stabilize and constrain reveals. */
        centerRange?: Readonly<ExplorerCenterRange>;
    } = $props();

    /** One compiled source, its independent store, and its reactive context. */
    interface SourceRuntime {
        /** Runtime model produced by Adapter.resolve. */
        model: SourceModel;
        /** Independently loaded and persisted source state. */
        store: SourceDataStore;
        /** Stable context passed to source render/effect methods. */
        context: SourceModelContext<object>;
    }

    // App keys this component by topic, so these source runtimes intentionally
    // capture the component instance's initial immutable topic membership.
    const topicData = untrack(() => workspace.topicData(topic.id));
    const runtimes: SourceRuntime[] = untrack(() => topic.sources.map(model => {
        const store = sourceStores.get(model);
        return {
            model,
            store,
            context: {
                get data() { return store.data; },
                get currentUrl() { return currentUrl.value; },
                navigateTo: ctx.navigateTo,
            },
        };
    }));

    ctx.setExplorer({
        topic: () => topic,
        workspace: () => workspace,
    });

    // Ignore subpixel layout noise that cannot produce visible movement.
    const SCROLL_EPSILON_PX = 0.5;
    let scrollViewport: HTMLDivElement;
    let revealGeneration = 0;
    let observedNavigationKey: string | null = null;
    let startedNavigationKey: string | null = null;
    let handledNavigationKey: string | null = null;
    let programmaticScrollMayBeActive = false;

    // Every source starts concurrently and can become usable independently.
    $effect(() => {
        for (const runtime of runtimes) void runtime.store.load();
    });

    // Deep reads across stores feed independent serialized save queues.
    $effect(() => {
        for (const runtime of runtimes) runtime.store.autoSave();
    });

    // Source effects bind only after validated data is ready. This outer effect
    // recreates child effects when readiness changes, avoiding partially loaded
    // source state without allowing one failure to block siblings.
    $effect(() => {
        for (const runtime of runtimes) {
            if (runtime.store.status === "ready")
                runtime.model.setupEffects?.(runtime.context);
        }
    });

    /** Render only validated ready sources; loading/error sources stay absent
     * from item composition and search until explicitly recovered. */
    const readySources = $derived.by((): ReadySourceView[] =>
        runtimes.flatMap(runtime => runtime.store.status === "ready"
            ? [{ model: runtime.model, view: runtime.model.render(runtime.context) }]
            : []));
    const output = $derived(composeTopicView(topic, readySources));
    const recentItemIds = $derived(recentlyAccessedItemIds(topic.id));

    // Host-accepted navigation remains the only source of MRU truth.
    $effect(() => {
        const activeItemId = output.search?.activeItemId;
        if (activeItemId && activeItemId in output.items)
            recordItemAccess(topic.id, activeItemId);
    });

    /** Return the rendered container for a composite item without interpolating
     * user/source-owned IDs into a CSS selector. */
    function findItemElement(itemId: string): HTMLElement | null {
        const items = scrollViewport.querySelectorAll<HTMLElement>(
            "[data-explorer-item-id]");
        return Array.from(items).find(
            element => element.dataset.explorerItemId === itemId) ?? null;
    }

    /** Resolve persisted group membership; no match means Ungrouped. */
    function findItemGroupName(itemId: ItemKey): string {
        for (const [groupName, group] of Object.entries(topicData.groups)) {
            if (group.items.includes(itemId)) return groupName;
        }
        return "";
    }

    /** Wait for group/item opening animations that determine final bounds. */
    async function waitForRevealLayout(card: HTMLElement): Promise<void> {
        await new Promise<void>(resolve =>
            window.requestAnimationFrame(() => resolve()));

        const animations = card.getAnimations({ subtree: true });
        let ancestor = card.parentElement;
        while (ancestor && ancestor !== scrollViewport) {
            if (ancestor.dataset.slot === "collapsible-content")
                animations.push(...ancestor.getAnimations());
            ancestor = ancestor.parentElement;
        }
        await Promise.allSettled(animations.map(animation => animation.finished));
    }

    /** Stop an older smooth reveal before evaluating newer navigation. */
    function cancelProgrammaticScroll(): void {
        if (!programmaticScrollMayBeActive) return;
        scrollViewport.scrollTo({ top: scrollViewport.scrollTop, behavior: "auto" });
        programmaticScrollMayBeActive = false;
    }

    /** Apply one calculated reveal position. */
    function scrollToRevealPosition(scrollTop: number): void {
        const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth";
        programmaticScrollMayBeActive = behavior === "smooth";
        scrollViewport.scrollTo({ top: scrollTop, behavior });
    }

    /** Reveal one navigation using latest-wins cancellation. */
    async function revealActivePage(
        navigationKey: string,
        activeItemId: ItemKey,
        generation: number,
    ): Promise<void> {
        await tick();
        if (generation !== revealGeneration) return;

        expandGroup(topic.id, findItemGroupName(activeItemId));
        expandItems(topic.id, [activeItemId]);
        await tick();
        if (generation !== revealGeneration) return;

        const itemElement = findItemElement(activeItemId);
        const itemHeader = itemElement?.querySelector<HTMLElement>(
            "[data-explorer-item-header]");
        const page = itemElement?.querySelector<HTMLElement>('[aria-current="page"]');
        const target = page ?? itemHeader;
        if (!itemElement || !target) {
            handledNavigationKey = navigationKey;
            return;
        }

        await waitForRevealLayout(itemElement);
        if (generation !== revealGeneration) return;

        const currentScrollTop = scrollViewport.scrollTop;
        const nextScrollTop = calculateExplorerRevealScrollTop({
            viewport: scrollViewport.getBoundingClientRect(),
            card: itemElement.getBoundingClientRect(),
            target: target.getBoundingClientRect(),
            scrollTop: currentScrollTop,
            maxScrollTop: scrollViewport.scrollHeight - scrollViewport.clientHeight,
        }, centerRange);
        if (Math.abs(nextScrollTop - currentScrollTop) > SCROLL_EPSILON_PX)
            scrollToRevealPosition(nextScrollTop);
        handledNavigationKey = navigationKey;
    }

    // Only explicit host reports move the Explorer; data/source updates do not.
    $effect(() => {
        if (!reportedNavigationId) return;
        const navigationKey = `${topic.id}:${reportedNavigationId}`;
        if (navigationKey !== observedNavigationKey) {
            observedNavigationKey = navigationKey;
            cancelProgrammaticScroll();
            revealGeneration++;
        }

        const activeItemId = output.search?.activeItemId;
        if (!activeItemId || !(activeItemId in output.items)) return;
        if (navigationKey === handledNavigationKey ||
            navigationKey === startedNavigationKey) return;

        startedNavigationKey = navigationKey;
        const generation = revealGeneration;
        void revealActivePage(navigationKey, activeItemId, generation)
            .finally(() => {
                if (startedNavigationKey === navigationKey)
                    startedNavigationKey = null;
            });
    });

    // Persistence owners receive the same readiness evidence and centralize
    // their own cleanup rules; this view does not interpret stale identities.
    $effect(() => {
        const registeredSourceIds = topic.sources.map(source => source.id);
        const readySourceIds = readySources.map(source => source.model.id);
        const validItemIds = Object.keys(output.items) as ItemKey[];
        const groupNames = Object.keys(topicData.groups);
        workspace.reconcileTopicItems(topic.id, {
            registeredSourceIds,
            readySourceIds,
            validItemIds,
        });
        reconcileTopicUiState({
            topic,
            readySourceIds,
            validItemIds,
            groupNames,
        });
    });

    onDestroy(() => {
        revealGeneration++;
        cancelProgrammaticScroll();
    });
</script>

<div class="explorer">
    {#if output.search}
        <div class="search-region">
            <ExplorerSearch
                items={output.items}
                search={output.search}
                {recentItemIds} />
        </div>
    {/if}

    <div
        bind:this={scrollViewport}
        class="explorer-viewport"
        data-has-search={Boolean(output.search)}>
        {#each runtimes.filter(runtime =>
            runtime.store.status === "error" || runtime.store.saveError) as runtime (runtime.model.id)}
            <div class="source-status" role="alert">
                <span class="source-status-message">
                    {runtime.model.name}: {runtime.store.error ?? runtime.store.saveError}
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    onclick={() => runtime.store.status === "error"
                        ? runtime.store.retryLoad()
                        : runtime.store.retrySave()}>
                    Retry
                </Button>
            </div>
        {/each}

        {#if workspace.saveError}
            <div class="source-status" role="alert">
                <span class="source-status-message">Explorer groups: {workspace.saveError}</span>
                <Button variant="ghost" size="sm" onclick={() => workspace.retrySave()}>
                    Retry
                </Button>
            </div>
        {/if}

        {#each output.actions as action, index (index)}
            {#if action.type === "input"}
                <InputActionDialog {action} />
            {/if}
        {/each}

        <ExplorerGroup groupName="" explorerView={output} />
        {#each topicData.groupOrder.filter(name => name in topicData.groups) as groupName (groupName)}
            <ExplorerGroup {groupName} explorerView={output} />
        {/each}
        <div class="group-spacer"></div>
        <ExplorerCreateGroupComponent />
    </div>
</div>

<style>
    .explorer {
        display: flex;
        min-height: 0;
        flex: 1 1 0%;
        flex-direction: column;
    }

    .search-region {
        flex-shrink: 0;
        padding: 0.375rem 0.375rem 0;
    }

    .explorer-viewport {
        display: flex;
        min-height: 0;
        flex: 1 1 0%;
        flex-direction: column;
        overflow-y: auto;
        padding: 0.375rem;
    }

    .explorer-viewport[data-has-search="true"] { padding-top: 0; }

    .source-status {
        display: flex;
        min-height: 1.75rem;
        align-items: center;
        gap: 0.25rem;
        border-radius: var(--radius-sm);
        padding-left: 0.5rem;
        color: var(--color-destructive);
        font-size: 0.75rem;
    }

    .source-status-message {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .group-spacer {
        height: 0.25rem;
        flex-shrink: 0;
    }
</style>
