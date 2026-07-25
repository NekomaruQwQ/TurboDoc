<script lang="ts">
    import * as Collapsible from "@shadcn/components/ui/collapsible";

    import type { Item, ProviderOutput } from "@/core/data";
    import * as ctx from "@/core/context.svelte";
    import { groupExpanded } from "@/core/uiState.svelte";

    import ExplorerItem from "@/ui/explorer/ExplorerItem.svelte";
    import ExplorerGroupHeader from "@/ui/explorer/ExplorerGroupHeader.svelte";

    let {
        groupName,
        providerOutput,
    }: {
        /** Empty for the synthetic group containing every unassigned item. */
        groupName: string,
        providerOutput: ProviderOutput,
    } = $props();

    const provider = ctx.getProviderInfo();
    const store = ctx.getProviderData();
    const expanded = $derived(groupExpanded(provider.id, groupName));

    /** All items belonging to this group, sorted by `sortKey`. */
    const groupItems = $derived.by((): [string, Item][] => {
        const all = Object.entries(providerOutput.items) as [string, Item][];
        const filtered = groupName
            ? all.filter(([id]) => store.data.groups[groupName]?.items.includes(id) ?? false)
            : all.filter(([id]) =>
                !Object.values(store.data.groups).some(g => g.items.includes(id)));
        return filtered.sort(([, a], [, b]) => a.sortKey.localeCompare(b.sortKey));
    });

    // Bulk expansion operates on the rendered membership so dangling persisted
    // item IDs cannot leak into local UI state.
    const itemIds = $derived(groupItems.map(([itemId]) => itemId));
</script>

<Collapsible.Root
    open={expanded.value}
    onOpenChange={value => expanded.value = value}>
    <ExplorerGroupHeader {groupName} {itemIds} expanded={expanded.value} />
    <Collapsible.Content class="flex flex-col">
        {#each groupItems as [itemId, item] (itemId)}
            <ExplorerItem {item} itemGroupName={groupName} />
        {/each}
    </Collapsible.Content>
</Collapsible.Root>
