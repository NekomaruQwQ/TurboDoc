<script lang="ts">
    import { tick } from "svelte";
    import { Combobox } from "bits-ui";
    import LoaderCircle from "@lucide/svelte/icons/loader-circle";
    import Search from "@lucide/svelte/icons/search";

    import type { Item, ProviderSearch } from "@/core/data";
    import {
        buildItemSearchIndex,
        findExactItem,
        findPrefixItems,
        normalizeItemSearchText,
        resolveRecentItems,
    } from "@/core/itemSearch";

    import Icon from "@/ui/common/Icon.svelte";
    import InputActionDialog from "@/ui/explorer/InputActionDialog.svelte";

    const ADD_ACTION_VALUE = "action:add";
    const IMPORT_ACTION_VALUE = "action:import";
    const ITEM_VALUE_PREFIX = "item:";
    const SEARCH_ERROR_ID = "explorer-search-error";

    let {
        items,
        search,
        recentItemIds,
    }: {
        /** Every item currently rendered by the active provider. */
        items: Record<string, Item>,
        /** Provider-owned activation and free-form action behavior. */
        search: ProviderSearch,
        /** Provider-local MRU IDs, newest first. */
        recentItemIds: readonly string[],
    } = $props();

    let open = $state(false);
    let selectedValue = $state("");
    let inputValue = $state("");
    let importDialogOpen = $state(false);
    let pendingSearchText = $state<string | null>(null);
    let addError = $state<string | null>(null);

    const index = $derived(buildItemSearchIndex(items));
    const normalizedSearchText = $derived(normalizeItemSearchText(inputValue));
    const exactItem = $derived(findExactItem(index, inputValue));
    const visibleItems = $derived(normalizedSearchText
        ? findPrefixItems(index, inputValue)
        : resolveRecentItems(index, recentItemIds));
    const addAction = $derived(normalizedSearchText && !exactItem
        ? search.getAddAction(inputValue.trim())
        : null);

    /** Namespace item IDs away from fixed action values without restricting
     * the provider's identifier alphabet. */
    function itemValue(itemId: string): string {
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

    /** Convert arbitrary provider rejections into concise inline feedback. */
    function getActionErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : "Could not add this item.";
    }

    /** Dispatch tagged combobox values to provider callbacks. Async add
     * actions retain the submitted text, reject duplicate activation, and
     * only reset after the provider confirms success. */
    async function handleValueChange(value: string): Promise<void> {
        if (!value) return;

        if (value.startsWith(ITEM_VALUE_PREFIX)) {
            const itemId = value.slice(ITEM_VALUE_PREFIX.length);
            search.selectItem(itemId);
            await resetCombobox();
            return;
        }

        if (value === ADD_ACTION_VALUE) {
            const action = addAction;
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

        if (value === IMPORT_ACTION_VALUE && search.emptyAction) {
            await resetCombobox();
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
    <div class="relative mb-1 shrink-0">
        <Search
            aria-hidden="true"
            class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Combobox.Input
            aria-label={search.placeholder}
            aria-invalid={addError !== null}
            aria-describedby={addError ? SEARCH_ERROR_ID : undefined}
            autocomplete="off"
            spellcheck={false}
            disabled={pendingSearchText !== null}
            placeholder={search.placeholder}
            class="h-7 w-full rounded-sm border border-workbench-divider bg-transparent pr-2 pl-7 font-mono text-xs text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground hover:bg-input/20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-wait disabled:opacity-70"
            onfocus={() => open = true}
            onclick={() => open = true}
            oninput={handleInput} />
    </div>

    <Combobox.Portal>
        <Combobox.Content
            sideOffset={4}
            align="start"
            class="z-50 w-(--bits-combobox-anchor-width) overflow-hidden rounded-md border border-workbench-divider bg-popover text-popover-foreground shadow-md data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 motion-reduce:animate-none">
            <Combobox.Viewport class="max-h-64 p-1">
                {#if !normalizedSearchText && visibleItems.length > 0}
                    <div class="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                        Recent
                    </div>
                {/if}

                {#each visibleItems as entry (entry.id)}
                    <Combobox.Item
                        value={itemValue(entry.id)}
                        label={entry.item.name}
                        class="flex h-7 w-full cursor-default items-center rounded-sm px-2 font-mono text-xs outline-none select-none data-highlighted:bg-workbench-selection data-highlighted:text-foreground">
                        <span class="truncate">{entry.item.name}</span>
                    </Combobox.Item>
                {/each}

                {#if addError}
                    <p
                        id={SEARCH_ERROR_ID}
                        role="alert"
                        class="px-2 py-2 text-xs leading-4 text-destructive">
                        {addError}
                    </p>
                {:else if normalizedSearchText && visibleItems.length === 0 && !addAction}
                    <p role="status" class="px-2 py-2 text-xs leading-4 text-muted-foreground">
                        {search.invalidText}
                    </p>
                {/if}

                {#if pendingSearchText || addAction || (!normalizedSearchText && search.emptyAction)}
                    {#if visibleItems.length > 0}
                        <Combobox.Separator class="my-1 h-px bg-workbench-divider" />
                    {/if}
                    {#if pendingSearchText}
                        <div
                            role="status"
                            class="flex h-7 w-full items-center gap-2 rounded-sm px-2 text-xs text-muted-foreground">
                            <LoaderCircle
                                aria-hidden="true"
                                class="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
                            <span class="min-w-0 truncate">
                                Checking crate <code class="font-mono text-foreground">{pendingSearchText}</code>…
                            </span>
                        </div>
                    {:else if addAction}
                        <Combobox.Item
                            value={ADD_ACTION_VALUE}
                            label={addAction.name}
                            class="flex h-7 w-full cursor-default items-center gap-2 rounded-sm px-2 text-xs outline-none select-none data-highlighted:bg-workbench-selection data-highlighted:text-foreground">
                            <Icon icon={addAction.icon} size="sm" />
                            <span class="min-w-0 truncate">{addAction.name}</span>
                        </Combobox.Item>
                    {:else if search.emptyAction}
                        <Combobox.Item
                            value={IMPORT_ACTION_VALUE}
                            label={`${search.emptyAction.name}…`}
                            class="flex h-7 w-full cursor-default items-center gap-2 rounded-sm px-2 text-xs outline-none select-none data-highlighted:bg-workbench-selection data-highlighted:text-foreground">
                            <Icon icon={search.emptyAction.icon} size="sm" />
                            <span>{search.emptyAction.name}…</span>
                        </Combobox.Item>
                    {/if}
                {/if}
            </Combobox.Viewport>
        </Combobox.Content>
    </Combobox.Portal>
</Combobox.Root>

{#if search.emptyAction}
    <InputActionDialog
        action={search.emptyAction}
        bind:open={importDialogOpen}
        showTrigger={false} />
{/if}
