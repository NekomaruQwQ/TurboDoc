<script lang="ts">
    import type { Item, ProviderOutput } from "@/core/data";
    import * as Collapsible from "@shadcn/components/ui/collapsible";

    import * as ctxKeys from "@/core/context";
    import { groupExpanded } from "@/core/uiState.svelte";

    import ExplorerItem from "@/ui/explorer/ExplorerItem.svelte";
    import ExplorerGroupHeader from "@/ui/explorer/ExplorerGroupHeader.svelte";

    type Props =
        | { variant: "ungrouped"; providerOutput: ProviderOutput }
        | { variant: "default"; groupName: string; providerOutput: ProviderOutput };

    let props: Props = $props();

    const provider = ctxKeys.provider.get();
    const store = ctxKeys.providerData.get();

    // Group expansion state. The "ungrouped" pseudo-group uses a fixed
    // sentinel key so its expanded flag persists across sessions just
    // like a real group.
    const groupKey = $derived(props.variant === "default" ? props.groupName : "__ungrouped__");
    const expanded = $derived(groupExpanded(provider.id, groupKey));

    /** All items belonging to this group, sorted by `sortKey`. */
    const groupItems = $derived.by((): [string, Item][] => {
        const all = Object.entries(props.providerOutput.items) as [string, Item][];
        const filtered = props.variant === "default"
            ? all.filter(([id]) => store.data.groups[(props as { groupName: string }).groupName]?.items.includes(id) ?? false)
            : all.filter(([id]) =>
                !Object.values(store.data.groups).some(g => g.items.includes(id)));
        return filtered.sort(([, a], [, b]) => a.sortKey.localeCompare(b.sortKey));
    });
</script>

{#if props.variant === "ungrouped"}
    <ExplorerGroupHeader variant="ungrouped" />
    <div class="flex flex-col gap-2">
        {#each groupItems as [itemId, item] (itemId)}
            <ExplorerItem {item} itemGroupName="" />
        {/each}
    </div>
{:else}
    <Collapsible.Root open={expanded.value}>
        <ExplorerGroupHeader variant="default" groupName={props.groupName} />
        <Collapsible.Content class="flex flex-col gap-2">
            {#each groupItems as [itemId, item] (itemId)}
                <ExplorerItem {item} itemGroupName={props.groupName} />
            {/each}
        </Collapsible.Content>
    </Collapsible.Root>
{/if}
