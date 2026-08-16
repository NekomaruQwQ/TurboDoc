<script lang="ts">
    import { flip } from "svelte/animate";
    import * as _ from "remeda";
    import {
        dragHandle,
        dragHandleZone,
        type DndEvent,
    } from "svelte-dnd-action";

    import GripVertical from "@lucide/svelte/icons/grip-vertical";
    import Pin from "@lucide/svelte/icons/pin";

    import * as ctx from "@/core/context.svelte";
    import type { Item, Page } from "@/core/data";

    /** Shape required by svelte-dnd-action; URLs are stable page identities. */
    type DraggablePage = {
        id: string;
        page?: Page;
    };

    const { item }: { item: Item } = $props();
    const provider = ctx.getProviderInfo();
    const navigateTo = ctx.navigateTo;
    const manuallyOrdered = $derived(item.reorderPages !== undefined);
    const fixedPages = $derived(item.pages.filter(page => page.pinned === null));
    const previewPages = $derived(item.pages.filter(page => page.pinned === false));
    const pinnedPages = $derived(item.pages.filter(page => page.pinned === true));
    const sortedPages = $derived(_.sortBy(item.pages, page => page.sortKey));
    let draggablePages = $state<DraggablePage[]>([]);
    const flipDurationMs = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")
        .matches ? 0 : 100;

    // A provider render replaces page callbacks after persistence changes, so
    // rebuild drag records only when its pinned page list actually changes.
    $effect(() => {
        draggablePages = pinnedPages.map(page => ({ id: page.url, page }));
    });

    /** Flatten either page-name representation for accessible drag labels. */
    function pageAccessibleName(page: Page): string {
        return page.name.type === "symbol"
            ? page.name.path.map(segment => segment.name).join(page.name.separator)
            : page.name.text;
    }

    /** Mirror pointer/keyboard consideration so the action can make room. */
    function considerPageOrder(event: CustomEvent<DndEvent<DraggablePage>>): void {
        draggablePages = event.detail.items;
    }

    /** Commit only complete page records; the provider validates permutation. */
    function finalizePageOrder(event: CustomEvent<DndEvent<DraggablePage>>): void {
        draggablePages = event.detail.items;
        const orderedUrls = draggablePages
            .map(entry => entry.page?.url)
            .filter((url): url is string => url !== undefined);
        item.reorderPages?.(orderedUrls);
    }
</script>

<div class="page-list" data-manual-order={manuallyOrdered}>
    {#if manuallyOrdered}
        {#each fixedPages as page (page.url)}
            <div class="page-entry">
                {@render PageItemRenderer(page, false)}
            </div>
        {/each}
        <div
            class="page-list-sortable"
            aria-label={`Pinned pages for ${item.name}`}
            use:dragHandleZone={{
                items: draggablePages,
                type: `page-order:${provider.id}:${item.id}`,
                flipDurationMs,
                delayTouchStart: true,
                dropTargetClasses: ["page-list-drop-target"],
            }}
            onconsider={considerPageOrder}
            onfinalize={finalizePageOrder}>
            {#each draggablePages as entry (entry.id)}
                <div
                    class="page-entry"
                    aria-label={entry.page && pageAccessibleName(entry.page)}
                    animate:flip={{ duration: flipDurationMs }}>
                    {#if entry.page}
                        {@render PageItemRenderer(entry.page, true)}
                    {/if}
                </div>
            {/each}
        </div>
        {#each previewPages as page (page.url)}
            <div class="page-entry">
                {@render PageItemRenderer(page, false)}
            </div>
        {/each}
    {:else}
        {#each sortedPages as page (page.url)}
            <div class="page-entry">
                {@render PageItemRenderer(page, false)}
            </div>
        {/each}
    {/if}
</div>

{#snippet PageItemRenderer(page: Page, draggable: boolean)}
    <div
        class="page-row"
        data-current={page.current}>
        {#if manuallyOrdered}
            <span class="drag-slot">
                {#if draggable}
                    <span
                        class="drag-handle"
                        use:dragHandle
                        aria-label={`Reorder ${pageAccessibleName(page)}`}>
                        <GripVertical aria-hidden="true" />
                    </span>
                {/if}
            </span>
        {/if}
        <button
            onclick={() => navigateTo(page.url)}
            aria-current={page.current ? "page" : undefined}
            class="page-link"
            data-code-name={provider.renderPageNameAsCode}
            data-preview={page.pinned === false}>
            {#if page.name.type === "symbol"}
                {#each page.name.path as ident, i (i)}
                    {#if i > 0}<span>{page.name.separator}</span>{/if}
                    <span class="identifier" data-ident-type={ident.type}>{ident.name}</span>
                {/each}
            {:else}
                {page.name.text}
            {/if}
        </button>
        {#if page.pinned !== null}
            <button
                onclick={event => {
                    page.setPinned(!page.pinned);
                    event.stopPropagation();
                }}
                class="pin-action"
                aria-label={page.pinned ? "Unpin page" : "Pin page"}
                aria-pressed={page.pinned}>
                <Pin />
            </button>
        {/if}
    </div>
{/snippet}

<style>
    .page-list,
    .page-list-sortable {
        display: flex;
        flex-direction: column;
    }

    .page-list-sortable {
        border-radius: var(--radius-sm);
        transition: background-color 100ms, box-shadow 100ms;
    }

    :global(.page-list-sortable.page-list-drop-target) {
        background-color: color-mix(
            in oklab,
            var(--color-workbench-selection) 45%,
            transparent);
        box-shadow: inset 2px 0 0 var(--color-ring);
    }

    .page-entry {
        display: flex;
        min-width: 0;
    }

    .page-row {
        display: flex;
        width: 100%;
        height: 1.25rem;
        border-radius: var(--radius-sm);
        color: var(--color-muted-foreground);
        font-size: 0.75rem;
        transition: color 75ms, background-color 75ms;
    }

    .page-row:hover {
        background-color: var(--color-workbench-hover);
        color: var(--color-foreground);
    }

    .page-row[data-current="true"],
    .page-row[data-current="true"]:hover {
        background-color: var(--color-workbench-selection);
        color: var(--color-foreground);
    }

    .drag-slot {
        display: inline-flex;
        width: 1rem;
        height: 1.25rem;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
    }

    .drag-handle {
        display: inline-flex;
        width: 1rem;
        height: 1.25rem;
        cursor: grab;
        touch-action: none;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-sm);
        color: color-mix(in oklab, var(--color-foreground) 58%, transparent);
    }

    .drag-handle:active { cursor: grabbing; }

    .drag-handle:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 1px var(--color-ring);
        color: var(--color-foreground);
    }

    .drag-handle :global(svg) {
        width: 0.75rem;
        height: 0.75rem;
    }

    .page-link {
        display: inline-flex;
        min-width: 0;
        flex: 1 1 0%;
        align-items: center;
        overflow: hidden;
        border: 0;
        border-radius: var(--radius-sm);
        background-color: transparent;
        padding-inline: 0.375rem;
        color: inherit;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .page-link[data-code-name="true"] {
        font-family: var(--font-mono);
    }

    .page-link[data-preview="true"] {
        font-style: italic;
    }

    .page-link:focus-visible,
    .pin-action:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 1px var(--color-ring);
    }

    .identifier[data-ident-type="constant"],
    .identifier[data-ident-type="macro"] {
        color: var(--color-orange);
    }

    .identifier[data-ident-type="function"] { color: var(--color-blue); }
    .identifier[data-ident-type="interface"] { color: var(--color-cyan); }
    .identifier[data-ident-type="type"] { color: var(--color-yellow); }

    .pin-action {
        display: inline-flex;
        height: 1.25rem;
        aspect-ratio: 1;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: var(--radius-sm);
        background-color: transparent;
        color: color-mix(in oklab, var(--color-foreground) 70%, transparent);
    }

    .pin-action:hover {
        background-color: color-mix(in oklab, var(--color-input) 50%, transparent);
    }

    .pin-action[aria-pressed="false"] {
        opacity: 0;
    }

    .page-row:hover .pin-action,
    .page-row:focus-within .pin-action {
        opacity: 1;
    }

    .pin-action :global(svg) {
        width: 0.75rem;
        height: 0.75rem;
    }

    @media (prefers-reduced-motion: reduce) {
        .page-list-sortable,
        .page-row {
            transition: none;
        }
    }
</style>
