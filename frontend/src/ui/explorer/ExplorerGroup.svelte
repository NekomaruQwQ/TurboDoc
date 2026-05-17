<script lang="ts">
    import * as Collapsible from "@shadcn/components/ui/collapsible";

    import type { Item, ProviderOutput } from "@/core/data";
    import * as ctx from "@/core/context.svelte";
    import { groupExpanded } from "@/core/uiState.svelte";

    import ExplorerItem from "@/ui/explorer/ExplorerItem.svelte";
    import ExplorerGroupHeader from "@/ui/explorer/ExplorerGroupHeader.svelte";
    import {
        INNER_STYLE as GROUP_HEADER_INNER_STYLE,
        OUTER_STYLE as GROUP_HEADER_OUTER_STYLE,
    } from "@/ui/explorer/ExplorerGroupHeader.svelte";

    type Props =
        | { variant: "ungrouped"; providerOutput: ProviderOutput }
        | { variant: "default"; groupName: string; providerOutput: ProviderOutput };

    let props: Props = $props();

    const provider = ctx.getProviderInfo();
    const store = ctx.getProviderData();

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

{#if props.variant === "default"}
    {@const groupName = props.groupName}
    {@const expanded = groupExpanded(provider.id, props.groupName).value}
    <Collapsible.Root open={expanded}>
        <ExplorerGroupHeader groupName={groupName} />
        <Collapsible.Content class="flex flex-col gap-2">
            {#each groupItems as [itemId, item] (itemId)}
                <ExplorerItem {item} itemGroupName={groupName} />
            {/each}
            <div class="w-full h-0"></div>
        </Collapsible.Content>
    </Collapsible.Root>
{:else}
    <div class={GROUP_HEADER_OUTER_STYLE}>
        <p class={GROUP_HEADER_INNER_STYLE}>Ungrouped</p>
    </div>
    <div class="flex flex-col gap-2">
        {#each groupItems as [itemId, item] (itemId)}
            <ExplorerItem {item} itemGroupName="" />
        {/each}
        <div class="w-full h-0"></div>
    </div>
{/if}
