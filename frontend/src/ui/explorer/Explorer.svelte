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

    import ExplorerItem from "@/ui/explorer/ExplorerItem.svelte";
    import ExplorerGroup from "@/ui/explorer/ExplorerGroup.svelte";
    import ExplorerCreateGroupComponent from "@/ui/explorer/ExplorerCreateGroupComponent.svelte";
    import ExplorerHeader from "@/ui/explorer/ExplorerHeader.svelte";
    import ExplorerSearch from "@/ui/explorer/ExplorerSearch.svelte";
    import InputActionDialog from "@/ui/explorer/InputActionDialog.svelte";
    import { isVerticallyVisibleWithin } from "@/ui/explorer/visibility";

    let {
        provider,
        reportedNavigationId,
    }: {
        provider: Provider,
        /** Latest accepted host navigation. Unlike `currentUrl`, this changes
         * only when WebView2 reports navigation user-visible to the app. */
        reportedNavigationId: string | null,
    } = $props();

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
    // not write history directly; the accepted IPC navigation remains the
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

    /** Wait until the browser has created and completed any group/item opening
     * animations that clip the target. Cancelled animations are harmless: the
     * caller re-checks whether its navigation is still current afterward. */
    async function waitForRevealLayout(
        target: HTMLElement,
    ): Promise<void> {
        await new Promise<void>(resolve =>
            window.requestAnimationFrame(() => resolve()));

        const animations: Animation[] = [];
        let ancestor = target.parentElement;
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

    /** Minimally reveal `target`, remembering that smooth movement may still be
     * active so the next navigation can explicitly interrupt it. A completed
     * scroll makes that later cancellation a harmless same-position no-op. */
    function scrollTargetIntoView(target: HTMLElement): void {
        const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth";
        programmaticScrollMayBeActive = behavior === "smooth";
        target.scrollIntoView({ behavior, block: "nearest", inline: "nearest" });
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

        let itemElement = findItemElement(activeItemId);
        const visiblePage = itemElement?.querySelector<HTMLElement>(
            '[aria-current="page"]');
        if (visiblePage &&
            isVerticallyVisibleWithin(visiblePage, scrollViewport)) {
            handledNavigationKey = navigationKey;
            return;
        }

        // A page hidden by either collapsible must first be mounted and given
        // its final layout before the minimal nearest-edge scroll is computed.
        if (provider.enableItemGrouping)
            expandGroup(provider.id, findItemGroupName(activeItemId));
        expandItems(provider.id, [activeItemId]);
        await tick();
        if (generation !== revealGeneration) return;

        itemElement = findItemElement(activeItemId);
        const itemHeader = itemElement?.querySelector<HTMLElement>(
            "[data-explorer-item-header]");
        const page = itemElement?.querySelector<HTMLElement>(
            '[aria-current="page"]');
        const target = page ?? itemHeader;
        if (!target) {
            handledNavigationKey = navigationKey;
            return;
        }

        await waitForRevealLayout(target);
        if (generation !== revealGeneration) return;

        if (!isVerticallyVisibleWithin(target, scrollViewport))
            scrollTargetIntoView(target);
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

<div class="flex min-h-0 flex-1 flex-col">
    <ExplorerHeader {provider} />
    <div
        bind:this={scrollViewport}
        class="flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5">
        {#if output.search}
            <ExplorerSearch
                items={output.items}
                search={output.search}
                {recentItemIds} />
        {/if}

        <!-- Provider-level actions (e.g. "Import"). Only the "input" variant
             renders a dialog; "menu" is reserved for future inline menu items. -->
        {#each output.actions ?? [] as action, i (i)}
            {#if action.type === "input"}
                <InputActionDialog {action} />
            {/if}
        {/each}

        {#if provider.enableItemGrouping}
            <!-- The empty name is the data model's stable identity for items
                 not assigned to a persisted group. -->
            <ExplorerGroup groupName="" providerOutput={output} />
            {#each store.data.groupOrder.filter(g => g in store.data.groups) as groupName (groupName)}
                <ExplorerGroup {groupName} providerOutput={output} />
            {/each}
            <div class="h-1 shrink-0"></div>
            <ExplorerCreateGroupComponent />
        {:else}
            {#each Object.entries(output.items) as [itemId, item] (itemId)}
                <ExplorerItem {item} itemGroupName="" />
            {/each}
        {/if}
    </div>
</div>
