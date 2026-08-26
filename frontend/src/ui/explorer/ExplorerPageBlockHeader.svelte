<script lang="ts">
    import Ellipsis from "@lucide/svelte/icons/ellipsis";
    import Pencil from "@lucide/svelte/icons/pencil";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import * as DropdownMenu from "@shadcn/components/ui/dropdown-menu";
    import type { PageBlock, PageBlockNameAction } from "@/core/data";

    const { block, onrename, onremove }: {
        /** Neutral heading and optional editing capabilities. */
        block: PageBlock;
        /** The parent owns editing so renaming can relocate a keyed block. */
        onrename(action: PageBlockNameAction): void;
        /** The parent presents any provider-owned removal confirmation. */
        onremove(action: NonNullable<PageBlock["remove"]>): void;
    } = $props();

    /** Removing the menu for inline rename must not reclaim field focus. */
    let renaming = false;
</script>

<div class="block-header">
    <span class="block-title" title={block.titlePath?.join(" › ")}>
        {block.titlePath?.join(" › ")}
    </span>
    <span class="index-rule" aria-hidden="true"></span>
    {#if block.rename || block.remove}
        <DropdownMenu.Root>
            <DropdownMenu.Trigger
                class="page-block-actions"
                data-block-actions
                aria-label={`Actions for ${block.titlePath?.join(" › ")}`}>
                <Ellipsis aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" onCloseAutoFocus={event => {
                // The inline field takes focus on mount after Rename.
                if (renaming) event.preventDefault();
            }}>
                {#if block.rename}
                    <DropdownMenu.Item onSelect={() => {
                        renaming = true;
                        if (block.rename) onrename(block.rename);
                    }}>
                        <Pencil />{block.rename.label}
                    </DropdownMenu.Item>
                {/if}
                {#if block.remove}
                    <DropdownMenu.Item onSelect={() => {
                        if (block.remove) onremove(block.remove);
                    }}>
                        <Trash2 />{block.remove.label}
                    </DropdownMenu.Item>
                {/if}
            </DropdownMenu.Content>
        </DropdownMenu.Root>
    {/if}
</div>

<style>
    .block-header {
        display: flex;
        min-width: 0;
        min-height: 1.5rem;
        align-items: center;
        gap: 0.5rem;
        margin-top: 0.375rem;
        padding-left: 0.375rem;
        color: color-mix(in oklab, var(--color-muted-foreground) 68%, transparent);
        font-size: 0.75rem;
    }

    :global(.page-list[data-manual-order="true"]) .block-header { padding-left: 1.375rem; }

    .block-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .index-rule {
        min-width: 0.5rem;
        height: 1px;
        flex: 1;
        background: var(--color-workbench-divider);
    }

    :global(.page-block-actions) {
        display: inline-flex;
        width: 1.25rem;
        height: 1.25rem;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-muted-foreground);
    }

    :global(.page-block-actions:hover),
    :global(.page-block-actions[data-state="open"]) {
        background: var(--color-workbench-hover);
        color: var(--color-foreground);
    }

    :global(.page-block-actions:focus-visible) {
        outline: 1px solid var(--color-ring);
        outline-offset: -1px;
    }

    :global(.page-block-actions svg) { width: 0.875rem; height: 0.875rem; }
</style>
