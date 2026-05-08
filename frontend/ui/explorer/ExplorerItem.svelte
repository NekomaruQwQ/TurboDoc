<script lang="ts">
    import Ellipsis from "@lucide/svelte/icons/ellipsis";

    import type { Item, ItemVersions } from "@/core/data";

    import { Separator } from "@shadcn/components/ui/separator";
    import * as Collapsible from "@shadcn/components/ui/collapsible";
    import * as Select from "@shadcn/components/ui/select";

    import * as ctxKeys from "@/core/context";
    import { itemExpanded } from "@/core/uiState.svelte";

    import ExplorerItemMenu from "@/ui/explorer/ExplorerItemMenu.svelte";
    import ExplorerPageList from "@/ui/explorer/ExplorerPageList.svelte";

    let { item, itemGroupName }: { item: Item; itemGroupName: string } = $props();

    const provider = ctxKeys.provider.get();
    const expanded = $derived(itemExpanded(provider.id, item.id));
</script>

<Collapsible.Root
    class="flex flex-col p-1 gap-1 rounded-md bg-card border shadow-sm truncate"
    open={expanded.value}
    onOpenChange={v => expanded.value = v}>
    <div class="flex flex-row gap-1">
        <Collapsible.Trigger class="flex-1 pl-1.5 truncate text-left font-mono cursor-pointer">
            {item.name}
        </Collapsible.Trigger>
        {#if item.versions}
            {@const versions: ItemVersions = item.versions}
            <Select.Root type="single" value={versions.current} onValueChange={versions.setCurrentVersion}>
                <Select.Trigger
                    size="sm"
                    class="pl-2 pr-1 py-0 w-24 h-6 rounded-sm shadow-none text-xs text-foreground/60 cursor-pointer">
                    {versions.current}
                </Select.Trigger>
                <Select.Content>
                    {#each versions.recommended as version (version)}
                        <Select.Item value={version} class="text-sm h-7 cursor-pointer">
                            {version}
                        </Select.Item>
                    {/each}
                    <Select.Separator class="m-0.5" />
                    <!-- Placeholder for future full version list popup. -->
                    <Select.Item value="..." disabled class="h-7 px-2 text-sm">
                        <Ellipsis class="mr-1 inline" />
                        <span>More versions</span>
                    </Select.Item>
                </Select.Content>
            </Select.Root>
        {/if}
        <ExplorerItemMenu {item} {itemGroupName} />
    </div>
    <Collapsible.Content class="flex flex-col">
        <Separator />
        <div class="h-1"></div>
        <ExplorerPageList pages={item.pages} />
    </Collapsible.Content>
</Collapsible.Root>
