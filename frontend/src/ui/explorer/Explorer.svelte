<script lang="ts">
    import { onDestroy, tick } from "svelte";

    import type { Provider, ProviderContext, ProviderData } from "@/core/data";
    import * as ctx from "@/core/context.svelte";
    import { ProviderDataStore } from "@/core/providerData.svelte";
    import {
        currentUrl,
        expandGroup,
        expandItems,
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
        provider,
        reportedNavigationId,
        centerRange = DEFAULT_EXPLORER_CENTER_RANGE,
    }: {
        provider: Provider,
        /** Latest accepted host navigation. Unlike `currentUrl`, this changes
         * only when WebView2 reports navigation user-visible to the app. */
        reportedNavigationId: string | null,
        /** Fractional viewport band used to stabilize and constrain reveals. */
        centerRange?: Readonly<ExplorerCenterRange>,
    } = $props();

    // Ignore subpixel layout noise that cannot produce a visible movement.
    const SCROLL_EPSILON_PX = 0.5;
    let scrollViewport: HTMLDivElement;
    let revealGeneration = 0;
    let observedNavigationKey: string | null = null;
    let startedNavigationKey: string | null = null;
    let handledNavigationKey: string | null = null;
    let programmaticScrollMayBeActive = false;

    const store = $derived(new ProviderDataStore(provider.id));
    ctx.setProvider({
        info: () => provider,
        data: () => store,
    });

    const providerContext: ProviderContext = {
        get data() { return store.data.data; },
        set data(next) { store.data.data = next; },
        get currentUrl() { return currentUrl.value; },
        navigateTo: ctx.navigateTo,
    };

    // -- Lifecycle effects --

    // Initial load. Idempotent — `store.load()` short-circuits after the
    // first call.
    $effect(() => { store.load(); });

    // Auto-save. Reads `store.data` deeply via JSON.stringify, so any
    // mutation in the proxy graph re-runs this effect.
    $effect(() => { store.autoSave(); });

    // Provider-specific effects (e.g. URL sync and initial seeding). Defined
    // in a `*.svelte.ts` module so its inner `$effect` calls bind to this
    // host component's lifecycle.
    $effect(() => provider.setupEffects?.(providerContext));

    // -- Derived view model --

    const output = $derived(provider.render(providerContext));
    const recentItemIds = $derived(recentlyAccessedItemIds(provider.id));

    // Record navigation-derived access only after the provider can resolve the
    // active URL to an item currently present in its output. Search clicks do
    // not write history directly; the accepted host navigation remains the
    // source of truth and repeated effects become storage no-ops.
    $effect(() => {
        const activeItemId = output.search?.activeItemId;
        if (activeItemId && activeItemId in output.items)
            recordItemAccess(provider.id, activeItemId);
    });

    /** Return the rendered container for a provider item without interpolating
     * the provider-owned ID into a CSS selector. */
    function findItemElement(itemId: string): HTMLElement | null {
        const items = scrollViewport.querySelectorAll<HTMLElement>(
            "[data-explorer-item-id]");
        return Array.from(items).find(
            element => element.dataset.explorerItemId === itemId) ?? null;
    }

    /** Resolve persisted group membership; an absent match means the stable
     * synthetic Ungrouped section identified by the empty string. */
    function findItemGroupName(itemId: string): string {
        for (const [groupName, group] of Object.entries(store.data.groups)) {
            if (group.items.includes(itemId)) return groupName;
        }
        return "";
    }

    /** Wait until the browser has created and completed the group/item opening
     * animations that determine the card's final bounds. Cancelled animations
     * are harmless: the caller checks its navigation generation afterward. */
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

    /** Stop an older smooth reveal at its current position before evaluating a
     * newer navigation. Without this, the browser can keep moving toward a
     * stale page even when the replacement page was visible when reported. */
    function cancelProgrammaticScroll(): void {
        if (!programmaticScrollMayBeActive) return;
        scrollViewport.scrollTo({ top: scrollViewport.scrollTop, behavior: "auto" });
        programmaticScrollMayBeActive = false;
    }

    /** Apply one calculated reveal position, remembering that smooth movement
     * may still be active so the next navigation can explicitly interrupt it. */
    function scrollToRevealPosition(scrollTop: number): void {
        const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth";
        programmaticScrollMayBeActive = behavior === "smooth";
        scrollViewport.scrollTo({ top: scrollTop, behavior });
    }

    /** Reveal the active page for one reported navigation. The operation is
     * latest-wins because canonicalization and rapid iframe navigation can
     * supersede it while Svelte or the collapse animations are settling. */
    async function revealActivePage(
        navigationKey: string,
        activeItemId: string,
        generation: number,
    ): Promise<void> {
        await tick();
        if (generation !== revealGeneration) return;

        // Both collapsibles must be open before the complete card and selected
        // page can supply stable bounds for the single constrained scroll.
        expandGroup(provider.id, findItemGroupName(activeItemId));
        expandItems(provider.id, [activeItemId]);
        await tick();
        if (generation !== revealGeneration) return;

        const itemElement = findItemElement(activeItemId);
        const itemHeader = itemElement?.querySelector<HTMLElement>(
            "[data-explorer-item-header]");
        const page = itemElement?.querySelector<HTMLElement>(
            '[aria-current="page"]');
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

    // Auto-reveal is gated by the explicit host report rather than `currentUrl`
    // alone, so loading data, refreshing metadata, and storage synchronization
    // cannot unexpectedly move the Explorer.
    $effect(() => {
        if (!reportedNavigationId) return;
        const navigationKey = `${provider.id}:${reportedNavigationId}`;
        if (navigationKey !== observedNavigationKey) {
            observedNavigationKey = navigationKey;
            cancelProgrammaticScroll();
            revealGeneration++;
        }

        const activeItemId = output.search?.activeItemId;
        if (!activeItemId ||
            !(activeItemId in output.items)) return;
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

    // Prevent detached component work from applying a late scroll after a
    // provider switch or workbench teardown.
    onDestroy(() => {
        revealGeneration++;
        cancelProgrammaticScroll();
    });

    // -- Eager orphan cleanup --
    // Items can disappear (e.g. crate deleted) while their IDs still
    // linger in `groups[*].items`. Drop dangling IDs after each render.
    //
    // Critical: only assign back when the filtered array actually
    // shrinks. Always writing (even when the filter is a no-op) flips
    // the `$state` proxy and invalidates `output`, which would re-run
    // this effect indefinitely.
    $effect(() => {
        const validIds = new Set(Object.keys(output.items));
        const groups = (store.data as ProviderData).groups;
        for (const group of Object.values(groups)) {
            const next = group.items.filter(id => validIds.has(id));
            if (next.length !== group.items.length) group.items = next;
        }
    });
</script>

<div class="explorer">
    {#if output.search}
        <!-- Search owns a fixed row so crate navigation and manual scrolling
             use only the unobstructed list viewport below it. -->
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
        <!-- Provider-level actions (e.g. "Import"). Only the "input" variant
             renders a dialog; "menu" is reserved for future inline menu items. -->
        {#each output.actions ?? [] as action, i (i)}
            {#if action.type === "input"}
                <InputActionDialog {action} />
            {/if}
        {/each}

        <!-- Grouping belongs to the Explorer for every provider. The empty
             name identifies items not assigned to a persisted group. -->
        <ExplorerGroup groupName="" providerOutput={output} />
        {#each store.data.groupOrder.filter(g => g in store.data.groups) as groupName (groupName)}
            <ExplorerGroup {groupName} providerOutput={output} />
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

    .explorer-viewport[data-has-search="true"] {
        padding-top: 0;
    }

    .group-spacer {
        height: 0.25rem;
        flex-shrink: 0;
    }
</style>
