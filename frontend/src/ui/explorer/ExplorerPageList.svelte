<script lang="ts">
    import * as _ from "remeda";

    import Pin from "@lucide/svelte/icons/pin";

    import { currentUrl } from "@/core/uiState.svelte";
    import * as ctx from "@/core/context.svelte";
    const navigateTo = ctx.navigateTo;

    import type { Page } from "@/core/data";
    const props: { pages: Page[] } = $props();
    const pages = $derived(_.sortBy(props.pages, p => p.sortKey));
</script>

<div class="page-list">
    {#each pages as page (page.url)}
        <div class="page-entry">
            {@render PageItemRenderer(page)}
        </div>
    {/each}
</div>

{#snippet PageItemRenderer(page: Page)}
    {@const isCurrent = page.url === currentUrl.value}
    <div
        class="page-row"
        data-current={isCurrent}>
        <button
            onclick={() => navigateTo(page.url)}
            aria-current={isCurrent ? "page" : undefined}
            class="page-link"
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
                onclick={e => { page.setPinned(!page.pinned); e.stopPropagation(); }}
                class="pin-action"
                aria-label={page.pinned ? "Unpin page" : "Pin page"}
                aria-pressed={page.pinned}>
                <Pin />
            </button>
        {/if}
    </div>
{/snippet}

<style>
    .page-list {
        display: flex;
        flex-direction: column;
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
        font-family: var(--font-mono);
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
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
</style>
