<script lang="ts">
    import type { Provider, ProviderContext, ProviderData } from "@/core/data";
    import * as ctxKeys from "@/core/context";
    import { ProviderDataStore } from "@/core/providerData.svelte";
    import { currentUrl } from "@/core/uiState.svelte";

    import ExplorerItem from "@/ui/explorer/ExplorerItem.svelte";
    import ExplorerGroup from "@/ui/explorer/ExplorerGroup.svelte";
    import ExplorerCreateGroupComponent from "@/ui/explorer/ExplorerCreateGroupComponent.svelte";
    import InputActionDialog from "@/ui/explorer/InputActionDialog.svelte";

    let { provider }: { provider: Provider } = $props();

    // Publish to descendants.
    ctxKeys.provider.set(provider);
    const store = new ProviderDataStore(provider.id);
    ctxKeys.providerData.set(store);

    const navigate = ctxKeys.navigateTo.get();

    // Build the provider context once. Getters keep the values reactive —
    // `$derived` blocks reading `ctx.data` or `ctx.currentUrl` retrack on
    // every change.
    const ctx: ProviderContext = {
        get data() { return store.data.data; },
        get currentUrl() { return currentUrl.value; },
        navigateTo: navigate,
    };

    // -- Lifecycle effects --

    // Initial load. Idempotent — `store.load()` short-circuits after the
    // first call.
    $effect(() => { store.load(); });

    // Auto-save. Reads `store.data` deeply via JSON.stringify, so any
    // mutation in the proxy graph re-runs this effect.
    $effect(() => { store.autoSave(); });

    // Provider-specific effects (e.g. URL sync, batch fetches). Defined
    // in a `*.svelte.ts` module so its inner `$effect` calls bind to this
    // host component's lifecycle.
    if (provider.setupEffects) provider.setupEffects(ctx);

    // -- Derived view model --

    const output = $derived(provider.render(ctx));

    // -- Eager orphan cleanup --
    // Items can disappear (e.g. crate deleted) while their IDs still
    // linger in `groups[*].items`. After every render, drop dangling IDs.
    $effect(() => {
        const validIds = new Set(Object.keys(output.items));
        const groups = (store.data as ProviderData).groups;
        let dirty = false;
        for (const group of Object.values(groups)) {
            const before = group.items.length;
            group.items = group.items.filter(id => validIds.has(id));
            if (group.items.length !== before) dirty = true;
        }
        // No persistence trigger needed — autoSave $effect picks up the
        // mutation through the same proxy.
        void dirty;
    });
</script>

<div class="flex flex-col mb-2">
    <!-- Provider-level actions (e.g. "Import"). Only the "input" variant
         renders a dialog; "menu" is reserved for future inline menu items. -->
    {#each output.actions ?? [] as action, i (i)}
        {#if action.type === "input"}
            <InputActionDialog {action} />
        {/if}
    {/each}

    {#if provider.enableItemGrouping}
        <ExplorerGroup variant="ungrouped" providerOutput={output} />
        {#each store.data.groupOrder.filter(g => g in store.data.groups) as groupName (groupName)}
            <ExplorerGroup variant="default" {groupName} providerOutput={output} />
        {/each}
        <ExplorerCreateGroupComponent />
    {:else}
        {#each Object.entries(output.items) as [itemId, item] (itemId)}
            <ExplorerItem {item} itemGroupName="" />
        {/each}
    {/if}
</div>
