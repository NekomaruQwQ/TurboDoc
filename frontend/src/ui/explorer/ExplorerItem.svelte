<script lang="ts">
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import ChevronRight from "@lucide/svelte/icons/chevron-right";

    import type { Item } from "@/core/data";

    import * as Collapsible from "@shadcn/components/ui/collapsible";

    import * as ctx from "@/core/context.svelte";
    import { itemExpanded } from "@/core/uiState.svelte";

    import ExplorerItemMenu from "@/ui/explorer/ExplorerItemMenu.svelte";
    import ExplorerPageList from "@/ui/explorer/ExplorerPageList.svelte";

    let { item, itemGroupName }: { item: Item; itemGroupName: string } = $props();

    const provider = ctx.getProviderInfo();
    const expanded = $derived(itemExpanded(provider.id, item.id));
</script>

<Collapsible.Root
    class="flex flex-col truncate"
    data-explorer-item-id={item.id}
    open={expanded.value}
    onOpenChange={v => expanded.value = v}
    role="group"
    aria-label={`${item.name} crate`}>
    <div
        data-explorer-item-header
        class="group/item flex h-7 min-w-0 items-center rounded-sm px-0.5 hover:bg-workbench-hover focus-within:bg-workbench-hover">
        <Collapsible.Trigger
            class="flex h-7 min-w-0 flex-1 items-center gap-1 pl-1.5 text-left font-mono text-[13px]">
            {#if expanded.value}
                <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
            {:else}
                <ChevronRight class="size-3.5 shrink-0 text-muted-foreground" />
            {/if}
            <span class="truncate">{item.name}</span>
        </Collapsible.Trigger>
        <ExplorerItemMenu {item} {itemGroupName} />
    </div>
    <Collapsible.Content class="flex flex-col pl-5">
        <ExplorerPageList pages={item.pages} />
    </Collapsible.Content>
</Collapsible.Root>
