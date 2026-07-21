<script lang="ts">
    import Ellipsis from "@lucide/svelte/icons/ellipsis";
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import ChevronRight from "@lucide/svelte/icons/chevron-right";

    import type { Item, ItemVersions } from "@/core/data";

    import * as Collapsible from "@shadcn/components/ui/collapsible";
    import * as Select from "@shadcn/components/ui/select";

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
    open={expanded.value}
    onOpenChange={v => expanded.value = v}>
    <div
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
        {#if item.versions}{@render ExplorerItemVersionSelect(item.versions)}{/if}
        <ExplorerItemMenu {item} {itemGroupName} />
    </div>
    <Collapsible.Content class="flex flex-col pl-5">
        <ExplorerPageList pages={item.pages} />
    </Collapsible.Content>
</Collapsible.Root>

{#snippet ExplorerItemVersionSelect(versions: ItemVersions)}
    <Select.Root type="single" value={versions.current} onValueChange={versions.setCurrentVersion}>
        <Select.Trigger
            size="sm"
            class="h-5! w-21 rounded-sm border-transparent bg-transparent py-0 pr-1 pl-1.5 text-[11px] text-muted-foreground shadow-none hover:border-input hover:bg-input/30">
            {versions.current}
        </Select.Trigger>
        <Select.Content>
            {#each versions.recommended as version (version)}
                <Select.Item value={version} class="h-7 px-2 text-xs">
                    {version}
                </Select.Item>
            {/each}
            <Select.Separator class="m-0.5" />
            <!-- Placeholder for future full version list popup. -->
            <Select.Item value="..." disabled class="h-7 px-2 text-xs">
                <Ellipsis class="mr-1 inline" />
                <span>More versions</span>
            </Select.Item>
        </Select.Content>
    </Select.Root>
{/snippet}
