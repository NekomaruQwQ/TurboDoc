<script lang="ts">
    import { tick } from "svelte";
    import { flip } from "svelte/animate";
    import * as _ from "remeda";
    import {
        dragHandle,
        dragHandleZone,
        SOURCES,
        TRIGGERS,
        type DndEvent,
    } from "svelte-dnd-action";

    import GripVertical from "@lucide/svelte/icons/grip-vertical";
    import Pin from "@lucide/svelte/icons/pin";
    import Check from "@lucide/svelte/icons/check";
    import Plus from "@lucide/svelte/icons/plus";
    import { Button } from "@shadcn/components/ui/button";
    import * as Dialog from "@shadcn/components/ui/dialog";

    import * as ctx from "@/core/context.svelte";
    import type { Item, Page, PageBlock, PageBlockNameAction } from "@/core/data";
    import ExplorerPageBlockHeader from "./ExplorerPageBlockHeader.svelte";

    /** Shape required by svelte-dnd-action; URLs are stable page identities. */
    type DraggablePage = {
        id: string;
        page?: Page;
        isDndShadowItem?: boolean;
    };

    const { item }: { item: Item } = $props();
    const provider = ctx.getProviderInfo();
    const navigateTo = ctx.navigateTo;
    const manuallyOrdered = $derived(item.pageLayout?.reorder !== undefined);
    const pageByUrl = $derived(new Map(item.pages.map(page => [page.url, page])));
    const sortedPages = $derived(_.sortBy(item.pages, page => page.sortKey));
    let zones = $state<Record<string, DraggablePage[]>>({});
    let dragging = $state(false);
    let listElement: HTMLDivElement;
    let editing = $state<{ id?: string; action: PageBlockNameAction }>();
    let nameValue = $state("");
    let nameError = $state("");
    let removeAction = $state<PageBlock["remove"]>();
    let removeOpen = $state(false);
    let finalizeQueued = false;
    const flipDurationMs = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")
        .matches ? 0 : 100;

    // Only provider updates rebuild zones. Consider events stay local so two
    // zones can exchange their temporary shadow without persisting partial data.
    $effect(() => {
        zones = Object.fromEntries((item.pageLayout?.blocks ?? [])
            .filter(block => block.reorderable)
            .map(block => [block.id, block.pageUrls.flatMap(url => {
                const page = pageByUrl.get(url);
                return page?.pinned === true ? [{ id: url, page }] : [];
            })]));
    });

    /** Flatten either page-name representation for accessible drag labels. */
    function pageAccessibleName(page: Page): string {
        return page.name.type === "symbol"
            ? page.name.path.map(segment => segment.name).join(page.name.separator)
            : page.name.text;
    }

    /** Mirror pointer/keyboard consideration so the action can make room. */
    function considerPageOrder(id: string, event: CustomEvent<DndEvent<DraggablePage>>): void {
        zones[id] = event.detail.items;
        dragging = event.detail.info.trigger !== TRIGGERS.DRAG_STOPPED;
    }

    /** Commit only complete page records; the provider validates permutation. */
    function finalizePageOrder(id: string, event: CustomEvent<DndEvent<DraggablePage>>): void {
        zones[id] = event.detail.items;
        if (event.detail.info.source === SOURCES.POINTER) dragging = false;
        if (finalizeQueued) return;
        finalizeQueued = true;
        const layout = item.pageLayout;
        // Cross-zone drops finalize both endpoints in the same turn. Commit
        // their complete snapshot once; never save the source-only intermediate.
        queueMicrotask(() => {
            finalizeQueued = false;
            if (item.pageLayout !== layout) return;
            const blocks = layout?.blocks.filter(block => block.reorderable) ?? [];
            if (blocks.some(block => zones[block.id]?.some(entry =>
                !entry.page || entry.isDndShadowItem))) return;
            layout?.reorder?.(blocks.map(block => ({
                id: block.id,
                pageUrls: (zones[block.id] ?? []).flatMap(entry =>
                    entry.page ? [entry.page.url] : []),
            })));
        });
    }

    /** Keep editing outside keyed headers so alphabetical relocation is safe. */
    function startNameEdit(action: PageBlockNameAction, id?: string): void {
        nameValue = action.value;
        nameError = "";
        editing = { id, action };
    }

    /** Focus the inline editor immediately when its conditional form mounts. */
    function focusNameInput(node: HTMLInputElement): void {
        node.focus();
        node.select();
    }

    /** Escape returns focus to the invoking control; ordinary blur does not. */
    async function cancelName(): Promise<void> {
        const id = editing?.id;
        editing = undefined;
        await tick();
        const selector = id === undefined ? ".create-block"
            : `[data-block-id="${CSS.escape(id)}"] [data-block-actions]`;
        listElement.querySelector<HTMLElement>(selector)?.focus();
    }

    /** Keep validation errors inline; restore focus to the relocated heading. */
    async function confirmName(): Promise<void> {
        if (!editing) return;
        const result = editing.action.invoke(nameValue);
        if ("error" in result) {
            nameError = result.error;
            return;
        }
        editing = undefined;
        await tick();
        listElement.querySelector<HTMLElement>(
            `[data-block-id="${CSS.escape(result.blockId)}"] [data-block-actions]`)?.focus();
    }

    /** Nonempty removal needs provider-supplied confirmation, not a UI guess. */
    function requestRemove(action: NonNullable<PageBlock["remove"]>): void {
        if (action.confirmation) {
            removeAction = action;
            removeOpen = true;
        } else {
            action.invoke();
        }
    }
</script>

<div class="page-list" bind:this={listElement} data-manual-order={manuallyOrdered}>
    {#if item.pageLayout}
        {#each item.pageLayout.blocks as block (block.id)}
            <div class="page-block" data-block-id={block.id}>
                {#if editing && editing.id === block.id}
                    {@render NameEditor()}
                {:else if block.titlePath?.length}
                    <ExplorerPageBlockHeader
                        {block}
                        onrename={action => startNameEdit(action, block.id)}
                        onremove={requestRemove} />
                {/if}
                {#if block.reorderable && manuallyOrdered}
                    <div
                        class="page-list-sortable"
                        data-empty={(zones[block.id]?.length ?? 0) === 0}
                        data-drop-space={dragging || !!block.titlePath?.length}
                        aria-label={block.accessibleName ?? `Pages for ${item.name}`}
                        use:dragHandleZone={{
                            items: zones[block.id] ?? [],
                            type: `page-order:${provider.id}:${item.id}`,
                            flipDurationMs,
                            delayTouchStart: true,
                            dropTargetStyle: {},
                            dropTargetClasses: ["page-list-drop-target"],
                        }}
                        onconsider={event => considerPageOrder(block.id, event)}
                        onfinalize={event => finalizePageOrder(block.id, event)}>
                        {#each zones[block.id] ?? [] as entry (entry.id)}
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
                {:else}
                    {#each block.pageUrls as url (url)}
                        {@const page = pageByUrl.get(url)}
                        {#if page}
                            <div class="page-entry">
                                {@render PageItemRenderer(page, false)}
                            </div>
                        {/if}
                    {/each}
                {/if}
            </div>
        {/each}
        {#if item.pageLayout.create}
            {#if editing && editing.id === undefined}
                {@render NameEditor()}
            {:else}
                <button class="create-block" onclick={() => {
                    if (item.pageLayout?.create) startNameEdit(item.pageLayout.create);
                }}>
                    <Plus aria-hidden="true" />
                    {item.pageLayout.create.label}
                </button>
            {/if}
        {/if}
    {:else}
        {#each sortedPages as page (page.url)}
            <div class="page-entry">
                {@render PageItemRenderer(page, false)}
            </div>
        {/each}
    {/if}
</div>

{#snippet NameEditor()}
    <form class="block-name-editor" onsubmit={event => {
        event.preventDefault();
        void confirmName();
    }} onfocusout={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) editing = undefined;
    }}>
        <div class="block-name-controls">
            <input
                use:focusNameInput
                bind:value={nameValue}
                aria-label={editing?.action.label}
                aria-invalid={!!nameError}
                placeholder={editing?.action.placeholder}
                oninput={() => nameError = ""}
                onkeydown={event => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        void cancelName();
                    }
                }} />
            <button class="name-confirm" type="submit" aria-label="Confirm name">
                <Check aria-hidden="true" />
            </button>
        </div>
        {#if nameError}<span class="name-error" role="alert">{nameError}</span>{/if}
    </form>
{/snippet}

{#if removeAction}
    <Dialog.Root bind:open={removeOpen}>
        <Dialog.Content>
            <Dialog.Header>
                <Dialog.Title>{removeAction.label}?</Dialog.Title>
                <Dialog.Description>{removeAction.confirmation}</Dialog.Description>
            </Dialog.Header>
            <Dialog.Footer>
                <Button variant="outline" onclick={() => removeOpen = false}>Cancel</Button>
                <Button variant="destructive" onclick={() => {
                    removeOpen = false;
                    removeAction?.invoke();
                }}>{removeAction.label}</Button>
            </Dialog.Footer>
        </Dialog.Content>
    </Dialog.Root>
{/if}

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
                        aria-label={`Move ${pageAccessibleName(page)}`}>
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

    .page-list-sortable[data-empty="true"][data-drop-space="true"] {
        min-height: 1.25rem;
        background: color-mix(in oklab, var(--color-workbench-divider) 20%, transparent);
    }

    .page-block { min-width: 0; }

    .create-block {
        display: flex;
        width: 100%;
        min-height: 1.75rem;
        align-items: center;
        gap: 0.375rem;
        margin-top: 0.25rem;
        border: 0;
        border-radius: var(--radius-sm);
        padding-inline: 0.375rem;
        background: transparent;
        color: var(--color-muted-foreground);
        font-size: 0.75rem;
        text-align: left;
    }

    .create-block:hover,
    .name-confirm:hover { background: var(--color-workbench-hover); }

    .create-block:focus-visible,
    .name-confirm:focus-visible {
        outline: 1px solid var(--color-ring);
        outline-offset: -1px;
    }

    .create-block :global(svg),
    .name-confirm :global(svg) { width: 0.875rem; height: 0.875rem; }

    .block-name-editor { margin-block: 0.25rem; }
    .block-name-controls { display: flex; gap: 0.125rem; }

    .block-name-controls input {
        min-width: 0;
        height: 1.75rem;
        flex: 1;
        border: 1px solid var(--color-ring);
        border-radius: var(--radius-sm);
        padding-inline: 0.375rem;
        background: var(--color-workbench);
        color: var(--color-foreground);
        font-size: 0.75rem;
        outline: none;
    }

    .name-confirm {
        display: inline-flex;
        width: 1.75rem;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-muted-foreground);
    }

    .name-error { color: var(--color-destructive); font-size: 0.75rem; }

    @media (prefers-reduced-motion: reduce) {
        .page-list-sortable,
        .page-row { transition: none; }
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
