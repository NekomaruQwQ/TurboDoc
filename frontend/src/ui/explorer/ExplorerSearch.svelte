<script lang="ts">
    import { tick } from "svelte";
    import { Combobox } from "bits-ui";
    import LoaderCircle from "@lucide/svelte/icons/loader-circle";
    import Search from "@lucide/svelte/icons/search";

    import type {
        ExplorerInputAction,
        ExplorerItem,
        ExplorerSearchModel,
    } from "@/core/explorer";
    import {
        buildItemSearchIndex,
        findExactItem,
        findPrefixItems,
        normalizeItemSearchText,
        resolveRecentItems,
    } from "@/core/itemSearch";
    import { isItemKey, type ItemKey } from "@/core/itemKey";

    import Icon from "@/ui/common/Icon.svelte";
    import InputActionDialog from "@/ui/explorer/InputActionDialog.svelte";

    const ADD_ACTION_VALUE_PREFIX = "action:add:";
    const EMPTY_ACTION_VALUE_PREFIX = "action:empty:";
    const ITEM_VALUE_PREFIX = "item:";
    const SEARCH_ERROR_ID = "explorer-search-error";
    let {
        items,
        search,
        recentItemIds,
    }: {
        /** Every item currently composed by the active topic. */
        items: Record<ItemKey, ExplorerItem>,
        /** Topic-composed activation and free-form source actions. */
        search: ExplorerSearchModel,
        /** Topic-local composite MRU keys, newest first. */
        recentItemIds: readonly ItemKey[],
    } = $props();

    let open = $state(false);
    let selectedValue = $state("");
    let inputValue = $state("");
    let importDialogOpen = $state(false);
    let dialogAction = $state<ExplorerInputAction>();
    let pendingSearchText = $state<string | null>(null);
    let addError = $state<string | null>(null);

    const index = $derived(buildItemSearchIndex(items));
    const normalizedSearchText = $derived(normalizeItemSearchText(inputValue));
    const exactItem = $derived(findExactItem(index, inputValue));
    const visibleItems = $derived(normalizedSearchText
        ? findPrefixItems(index, inputValue)
        : resolveRecentItems(index, recentItemIds));
    const addActions = $derived(normalizedSearchText && !exactItem
        ? search.getAddActions(inputValue.trim())
        : []);

    /** Namespace item IDs away from fixed action values without restricting
     * each source's identifier alphabet. */
    function itemValue(itemId: ItemKey): string {
        return `${ITEM_VALUE_PREFIX}${itemId}`;
    }

    /** Keep the editable text as the source of truth, clear stale feedback,
     * and clear any previous selection when the user resumes typing. */
    function handleInput(event: Event): void {
        inputValue = (event.currentTarget as HTMLInputElement).value;
        selectedValue = "";
        addError = null;
    }

    /** Restore the search affordance after Bits UI finishes applying the
     * selected item's label, so that label cannot overwrite the cleared input. */
    async function resetCombobox(): Promise<void> {
        await tick();
        open = false;
        selectedValue = "";
        inputValue = "";
        addError = null;
    }

    /** Convert arbitrary source rejections into concise inline feedback. */
    function getActionErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : "Could not add this item.";
    }

    /** Dispatch tagged combobox values to source callbacks. Async add
     * actions retain the submitted text, reject duplicate activation, and
     * only reset after the source confirms success. */
    async function handleValueChange(value: string): Promise<void> {
        if (!value) return;

        if (value.startsWith(ITEM_VALUE_PREFIX)) {
            const itemId = value.slice(ITEM_VALUE_PREFIX.length);
            if (!isItemKey(itemId) || !(itemId in items)) return;
            search.selectItem(itemId);
            await resetCombobox();
            return;
        }

        if (value.startsWith(ADD_ACTION_VALUE_PREFIX)) {
            const index = Number(value.slice(ADD_ACTION_VALUE_PREFIX.length));
            const action = Number.isInteger(index) ? addActions[index] : undefined;
            if (!action || pendingSearchText) return;
            const submittedText = inputValue.trim();
            pendingSearchText = submittedText;
            addError = null;
            try {
                await action.invoke();
                await resetCombobox();
            } catch (error) {
                selectedValue = "";
                await tick();
                inputValue = submittedText;
                open = true;
                addError = getActionErrorMessage(error);
            } finally {
                pendingSearchText = null;
            }
            return;
        }

        if (value.startsWith(EMPTY_ACTION_VALUE_PREFIX)) {
            const index = Number(value.slice(EMPTY_ACTION_VALUE_PREFIX.length));
            const action = Number.isInteger(index) ? search.emptyActions[index] : undefined;
            if (!action) return;
            await resetCombobox();
            dialogAction = action;
            importDialogOpen = true;
        }
    }
</script>

<Combobox.Root
    type="single"
    bind:open
    bind:value={selectedValue}
    inputValue={inputValue}
    onValueChange={handleValueChange}
    allowDeselect={false}>
    <div class="search-field">
        <Search
            aria-hidden="true"
            class="explorer-search-icon" />
        <Combobox.Input
            aria-label={search.placeholder}
            aria-invalid={addError !== null}
            aria-describedby={addError ? SEARCH_ERROR_ID : undefined}
            autocomplete="off"
            spellcheck={false}
            disabled={pendingSearchText !== null}
            placeholder={search.placeholder}
            class="explorer-search-input"
            onfocus={() => open = true}
            onclick={() => open = true}
            oninput={handleInput} />
    </div>

    <Combobox.Portal>
        <Combobox.Content
            sideOffset={4}
            align="start"
            class="explorer-search-popup">
            <Combobox.Viewport class="explorer-search-options">
                {#if !normalizedSearchText && visibleItems.length > 0}
                    <div class="recent-label">
                        Recent
                    </div>
                {/if}

                {#each visibleItems as entry (entry.id)}
                    <Combobox.Item
                        value={itemValue(entry.id)}
                        label={entry.item.name}
                        class="explorer-search-item"
                        data-code-name={entry.item.presentation.renderItemNameAsCode}>
                        <span class="option-name">{entry.item.name}</span>
                    </Combobox.Item>
                {/each}

                {#if addError}
                    <p
                        id={SEARCH_ERROR_ID}
                        role="alert"
                        class="search-feedback"
                        data-tone="error">
                        {addError}
                    </p>
                {:else if normalizedSearchText && visibleItems.length === 0 && addActions.length === 0}
                    <p role="status" class="search-feedback" data-tone="muted">
                        {search.invalidText}
                    </p>
                {/if}

                {#if pendingSearchText || addActions.length > 0 ||
                    (!normalizedSearchText && search.emptyActions.length > 0)}
                    {#if visibleItems.length > 0}
                        <Combobox.Separator class="explorer-search-separator" />
                    {/if}
                    {#if pendingSearchText}
                        <div
                            role="status"
                            class="search-pending">
                            <LoaderCircle
                                aria-hidden="true"
                                class="explorer-search-spinner" />
                            <span class="pending-message">
                                Adding <code class="pending-term">{pendingSearchText}</code>…
                            </span>
                        </div>
                    {:else if addActions.length > 0}
                        {#each addActions as action, index (index)}
                            <Combobox.Item
                                value={`${ADD_ACTION_VALUE_PREFIX}${index}`}
                                label={action.name}
                                class="explorer-search-action">
                                <Icon icon={action.icon} size="sm" />
                                <span class="option-name">{action.name}</span>
                            </Combobox.Item>
                        {/each}
                    {:else}
                        {#each search.emptyActions as action, index (index)}
                            <Combobox.Item
                                value={`${EMPTY_ACTION_VALUE_PREFIX}${index}`}
                                label={`${action.name}…`}
                                class="explorer-search-action">
                                <Icon icon={action.icon} size="sm" />
                                <span class="option-name" title={action.name}>{action.name}…</span>
                            </Combobox.Item>
                        {/each}
                    {/if}
                {/if}
            </Combobox.Viewport>
        </Combobox.Content>
    </Combobox.Portal>
</Combobox.Root>

{#if dialogAction}
    <InputActionDialog
        action={dialogAction}
        bind:open={importDialogOpen}
        showTrigger={false} />
{/if}

<style>
    .search-field {
        position: relative;
        margin-bottom: 0.25rem;
        flex-shrink: 0;
    }

    :global(.explorer-search-icon) {
        pointer-events: none;
        position: absolute;
        top: 50%;
        left: 0.5rem;
        z-index: 1;
        width: 0.875rem;
        height: 0.875rem;
        translate: 0 -50%;
        color: var(--color-muted-foreground);
    }

    :global(.explorer-search-input) {
        width: 100%;
        height: 1.75rem;
        border: 1px solid var(--color-workbench-divider);
        border-radius: var(--radius-sm);
        background-color: transparent;
        padding: 0 0.5rem 0 1.75rem;
        color: var(--color-foreground);
        font-size: 0.75rem;
        outline: none;
        transition: color 150ms, border-color 150ms, background-color 150ms,
            box-shadow 150ms;
    }

    :global(.explorer-search-input::placeholder) {
        color: var(--color-muted-foreground);
        font-family: var(--font-sans);
    }

    :global(.explorer-search-input[data-code-name="true"]),
    :global(.explorer-search-item[data-code-name="true"]) {
        font-family: var(--font-mono);
    }

    :global(.explorer-search-input:hover) {
        background-color: color-mix(in oklab, var(--color-input) 20%, transparent);
    }

    :global(.explorer-search-input:focus-visible) {
        border-color: var(--color-ring);
        box-shadow: 0 0 0 2px color-mix(in oklab, var(--color-ring) 40%, transparent);
    }

    :global(.explorer-search-input:disabled) {
        cursor: wait;
        opacity: 0.7;
    }

    :global(.explorer-search-popup) {
        z-index: 50;
        width: var(--bits-combobox-anchor-width);
        overflow: hidden;
        border: 1px solid var(--color-workbench-divider);
        border-radius: var(--radius-md);
        background-color: var(--color-popover);
        color: var(--color-popover-foreground);
        box-shadow: 0 4px 6px -1px rgb(0 0 0 / 10%), 0 2px 4px -2px rgb(0 0 0 / 10%);
    }

    :global(.explorer-search-popup[data-state="open"]) {
        animation: search-popup-in 150ms ease-out;
    }

    :global(.explorer-search-popup[data-state="closed"]) {
        animation: search-popup-out 150ms ease-in;
    }

    :global(.explorer-search-options) {
        max-height: 16rem;
        padding: 0.25rem;
    }

    .recent-label {
        padding: 0.25rem 0.5rem;
        color: var(--color-muted-foreground);
        font-size: 10px;
        font-weight: 500;
        letter-spacing: 0.025em;
        text-transform: uppercase;
    }

    :global(.explorer-search-item),
    :global(.explorer-search-action) {
        display: flex;
        width: 100%;
        height: 1.75rem;
        cursor: default;
        align-items: center;
        border-radius: var(--radius-sm);
        padding-inline: 0.5rem;
        font-size: 0.75rem;
        outline: none;
        user-select: none;
    }

    :global(.explorer-search-action) {
        gap: 0.5rem;
    }

    :global(.explorer-search-item[data-highlighted]),
    :global(.explorer-search-action[data-highlighted]) {
        background-color: var(--color-workbench-selection);
        color: var(--color-foreground);
    }

    .option-name,
    .pending-message {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .search-feedback {
        padding: 0.5rem;
        font-size: 0.75rem;
        line-height: 1rem;
    }

    .search-feedback[data-tone="error"] { color: var(--color-destructive); }
    .search-feedback[data-tone="muted"] { color: var(--color-muted-foreground); }

    :global(.explorer-search-separator) {
        height: 1px;
        margin-block: 0.25rem;
        background-color: var(--color-workbench-divider);
    }

    .search-pending {
        display: flex;
        width: 100%;
        height: 1.75rem;
        align-items: center;
        gap: 0.5rem;
        border-radius: var(--radius-sm);
        padding-inline: 0.5rem;
        color: var(--color-muted-foreground);
        font-size: 0.75rem;
    }

    :global(.explorer-search-spinner) {
        width: 0.875rem;
        height: 0.875rem;
        flex-shrink: 0;
        animation: search-spinner 1s linear infinite;
    }

    .pending-term {
        color: var(--color-foreground);
        font-family: var(--font-mono);
    }

    @keyframes search-popup-in {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
    }

    @keyframes search-popup-out {
        from { opacity: 1; transform: scale(1); }
        to { opacity: 0; transform: scale(0.95); }
    }

    @keyframes search-spinner {
        to { transform: rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
        :global(.explorer-search-popup),
        :global(.explorer-search-spinner) {
            animation: none;
        }
    }
</style>
