<script lang="ts">
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import ChevronRight from "@lucide/svelte/icons/chevron-right";

    import type { ExplorerItem } from "@/core/explorer";

    import * as Collapsible from "@shadcn/components/ui/collapsible";

    import * as ctx from "@/core/context.svelte";
    import { itemExpanded } from "@/core/uiState.svelte";

    import ExplorerItemMenu from "@/ui/explorer/ExplorerItemMenu.svelte";
    import ExplorerPageList from "@/ui/explorer/ExplorerPageList.svelte";

    let { item, itemGroupName }: { item: ExplorerItem; itemGroupName: string } = $props();

    const topic = ctx.getTopic();
    const expanded = $derived(itemExpanded(topic.id, item.id));
</script>

<Collapsible.Root
    class="explorer-item"
    data-explorer-item-id={item.id}
    open={expanded.value}
    onOpenChange={v => expanded.value = v}
    role="group"
    aria-label={`${item.name} documentation`}>
    <div
        data-explorer-item-header
        class="item-header">
        <Collapsible.Trigger
            class="explorer-item-toggle">
            {#if expanded.value}
                <ChevronDown />
            {:else}
                <ChevronRight />
            {/if}
            <span
                class="item-name"
                data-code-name={item.presentation.renderItemNameAsCode}>
                {item.name}
            </span>
        </Collapsible.Trigger>
        <ExplorerItemMenu {item} {itemGroupName} />
    </div>
    <Collapsible.Content class="explorer-item-pages">
        <ExplorerPageList {item} />
    </Collapsible.Content>
</Collapsible.Root>

<style>
    :global(.explorer-item) {
        display: flex;
        flex-direction: column;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .item-header {
        display: flex;
        min-width: 0;
        height: 1.75rem;
        align-items: center;
        border-radius: var(--radius-sm);
        padding-inline: 0.125rem;
    }

    .item-header:hover,
    .item-header:focus-within {
        background-color: var(--color-workbench-hover);
    }

    :global(.explorer-item-toggle) {
        display: flex;
        min-width: 0;
        height: 1.75rem;
        flex: 1 1 0%;
        align-items: center;
        gap: 0.25rem;
        border: 0;
        background-color: transparent;
        padding-left: 0.375rem;
        color: inherit;
        font-size: 13px;
        text-align: left;
    }

    :global(.explorer-item-toggle svg) {
        width: 0.875rem;
        height: 0.875rem;
        flex-shrink: 0;
        color: var(--color-muted-foreground);
    }

    .item-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .item-name[data-code-name="true"] {
        font-family: var(--font-mono);
    }

    :global(.explorer-item-pages) {
        display: flex;
        flex-direction: column;
        padding-left: 1.25rem;
    }
</style>
