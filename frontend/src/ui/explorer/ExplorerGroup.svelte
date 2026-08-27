<script lang="ts">
    import * as Collapsible from "@shadcn/components/ui/collapsible";

    import type { ExplorerItem, ExplorerView } from "@/core/explorer";
    import * as ctx from "@/core/context.svelte";
    import type { ItemKey } from "@/core/itemKey";
    import { groupExpanded } from "@/core/uiState.svelte";

    import ExplorerItemComponent from "@/ui/explorer/ExplorerItem.svelte";
    import ExplorerGroupHeader from "@/ui/explorer/ExplorerGroupHeader.svelte";

    let {
        groupName,
        explorerView,
    }: {
        /** Empty for the synthetic group containing every unassigned item. */
        groupName: string,
        explorerView: ExplorerView,
    } = $props();

    const topic = ctx.getTopic();
    const topicData = ctx.getExplorerWorkspace().topicData(topic.id);
    const expanded = $derived(groupExpanded(topic.id, groupName));

    /** All items belonging to this group, sorted by `sortKey`. */
    const groupItems = $derived.by((): [ItemKey, ExplorerItem][] => {
        const all = Object.entries(explorerView.items) as [ItemKey, ExplorerItem][];
        const filtered = groupName
            ? all.filter(([id]) => topicData.groups[groupName]?.items.includes(id) ?? false)
            : all.filter(([id]) =>
                !Object.values(topicData.groups).some(group => group.items.includes(id)));
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
    <Collapsible.Content class="explorer-group-content">
        {#each groupItems as [itemId, item] (itemId)}
            <ExplorerItemComponent {item} itemGroupName={groupName} />
        {/each}
    </Collapsible.Content>
</Collapsible.Root>

<style>
    :global(.explorer-group-content) {
        display: flex;
        flex-direction: column;
    }
</style>
