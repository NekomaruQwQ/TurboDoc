<script lang="ts">
    import ChevronsDown from "@lucide/svelte/icons/chevrons-down";
    import ChevronsUp from "@lucide/svelte/icons/chevrons-up";
    import ArrowDown from "@lucide/svelte/icons/arrow-down";
    import ArrowUp from "@lucide/svelte/icons/arrow-up";
    import ArrowUpToLine from "@lucide/svelte/icons/arrow-up-to-line";
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import ChevronRight from "@lucide/svelte/icons/chevron-right";
    import Check from "@lucide/svelte/icons/check";
    import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
    import Pencil from "@lucide/svelte/icons/pencil";
    import LogIn from "@lucide/svelte/icons/log-in";
    import Trash2 from "@lucide/svelte/icons/trash-2";

    import { Button } from "@shadcn/components/ui/button";
    import { Input } from "@shadcn/components/ui/input";
    import * as Dialog from "@shadcn/components/ui/dialog";
    import * as DropdownMenu from "@shadcn/components/ui/dropdown-menu";
    import * as Collapsible from "@shadcn/components/ui/collapsible";

    import * as ctx from "@/core/context.svelte";
    import { expandItems, collapseItems, removeGroup, renameGroup } from "@/core/uiState.svelte";

    let {
        groupName,
        itemIds,
        expanded,
    }: {
        /** Empty for the synthetic ungrouped group. */
        groupName: string,
        /** Current rendered membership used by the bulk expansion actions. */
        itemIds: string[],
        /** Controlled state owned by the surrounding Collapsible root. */
        expanded: boolean,
    } = $props();

    const provider = ctx.getProviderInfo();
    const store = ctx.getProviderData();

    let deleteOpen = $state(false);
    let renaming = $state(false);
    let renameValue = $state("");

    const isUngrouped = $derived(groupName === "");
    const displayName = $derived(isUngrouped ? "Ungrouped" : groupName);
    const isFirst =
        $derived(store.data.groupOrder[0] === groupName);
    const isLast =
        $derived(store.data.groupOrder[store.data.groupOrder.length - 1] === groupName);
    const otherGroups =
        $derived(
            store.data
                .groupOrder
                .filter(name => name in store.data.groups)
                .filter(name => name !== groupName));

    function startRename(currentName: string) {
        renameValue = currentName;
        renaming = true;
    }

    function confirmRename(originalName: string) {
        renaming = false;
        const newName = renameValue.trim();
        if (!newName || newName === originalName) return;
        const group = store.data.groups[originalName] ?? { items: [] };
        delete store.data.groups[originalName];
        store.data.groups[newName] = group;
        const idx = store.data.groupOrder.indexOf(originalName);
        if (idx >= 0) store.data.groupOrder[idx] = newName;
        renameGroup(provider.id, originalName, newName);
    }

    function deleteGroup(groupName: string) {
        delete store.data.groups[groupName];
        store.data.groupOrder = store.data.groupOrder.filter(n => n !== groupName);
        removeGroup(provider.id, groupName);
    }

    function expandAll() {
        expandItems(provider.id, itemIds);
    }

    function collapseAll() {
        collapseItems(provider.id, itemIds);
    }

    function moveToTop(groupName: string) {
        const filtered = store.data.groupOrder.filter(n => n !== groupName);
        store.data.groupOrder = [groupName, ...filtered];
    }

    function moveUp(groupName: string) {
        const i = store.data.groupOrder.indexOf(groupName);
        const prev = store.data.groupOrder[i - 1];
        if (i > 0 && prev !== undefined) {
            store.data.groupOrder[i - 1] = groupName;
            store.data.groupOrder[i] = prev;
        }
    }

    function moveDown(groupName: string) {
        const i = store.data.groupOrder.indexOf(groupName);
        const next = store.data.groupOrder[i + 1];
        if (i >= 0 && next !== undefined) {
            store.data.groupOrder[i + 1] = groupName;
            store.data.groupOrder[i] = next;
        }
    }

    function moveUnder(sourceName: string, targetName: string) {
        const filtered = store.data.groupOrder.filter(n => n !== sourceName);
        const idx = filtered.indexOf(targetName);
        if (idx < 0) return;
        filtered.splice(idx + 1, 0, sourceName);
        store.data.groupOrder = filtered;
    }
</script>

{#if renaming}
    <div class="group-header">
        <!-- Inline rename input. Confirms on Enter, cancels on Escape or blur. -->
        <Input
            bind:value={renameValue}
            class="explorer-group-rename-input"
            onkeydown={e => {
                if (e.key === "Enter") confirmRename(groupName);
                else if (e.key === "Escape") renaming = false;
            }}
            onblur={() => confirmRename(groupName)} />
        <Button
            variant="ghost"
            class="explorer-group-confirm"
            aria-label="Confirm group name"
            onclick={() => confirmRename(groupName)}>
            <Check />
        </Button>
    </div>
{:else}
    <div class="group-header">
        <Collapsible.Trigger class="explorer-group-toggle">
            {#if expanded}
                <ChevronDown />
            {:else}
                <ChevronRight />
            {/if}
            <span class="group-name">{displayName}</span>
        </Collapsible.Trigger>

        {#if !isUngrouped}
            <!-- Rename pencil; visible on header hover. The synthetic
                 ungrouped group has no persisted name to mutate. -->
            <Button
                variant="ghost"
                class="explorer-group-rename"
                aria-label="Rename group"
                onclick={() => startRename(groupName)}>
                <Pencil />
            </Button>
        {/if}

        <!-- Bulk item actions are shared by every group; persistence actions
             are omitted for the synthetic ungrouped group. -->
        {@render GroupMenu(isUngrouped, isFirst, isLast, otherGroups)}

        {#if !isUngrouped}
            {@render GroupConfirmDeleteDialog(groupName)}
        {/if}
    </div>
{/if}

{#snippet GroupMenu(
    isUngrouped: boolean,
    isFirst: boolean,
    isLast: boolean,
    otherGroups: string[])}
    <!-- Group dropdown menu: expand/collapse all, move ops, delete. -->
    <DropdownMenu.Root>
        <DropdownMenu.Trigger
            class="explorer-group-menu-trigger"
            aria-label="Group actions">
            <EllipsisVertical />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
            <DropdownMenu.Item onSelect={expandAll}>
                <ChevronsDown />
                <span>Expand All</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={collapseAll}>
                <ChevronsUp />
                <span>Collapse All</span>
            </DropdownMenu.Item>
            {#if !isUngrouped}
                <DropdownMenu.Separator />
                <DropdownMenu.Item disabled={isFirst} onSelect={() => moveToTop(groupName)}>
                    <ArrowUpToLine />
                    <span>Move to Top</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item disabled={isFirst} onSelect={() => moveUp(groupName)}>
                    <ArrowUp />
                    <span>Move Up</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item disabled={isLast} onSelect={() => moveDown(groupName)}>
                    <ArrowDown />
                    <span>Move Down</span>
                </DropdownMenu.Item>
                {#if store.data.groupOrder.length > 1}
                    <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger>
                            <LogIn />
                            <span>Move Under</span>
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.SubContent>
                            {#each otherGroups as targetName (targetName)}
                                <DropdownMenu.Item onSelect={() => moveUnder(groupName, targetName)}>
                                    {targetName}
                                </DropdownMenu.Item>
                            {/each}
                        </DropdownMenu.SubContent>
                    </DropdownMenu.Sub>
                {/if}
                <DropdownMenu.Separator />
                <DropdownMenu.Item variant="destructive" onSelect={() => deleteOpen = true}>
                    <Trash2 />
                    <span>Delete Group</span>
                </DropdownMenu.Item>
            {/if}
        </DropdownMenu.Content>
    </DropdownMenu.Root>
{/snippet}

<style>
    .group-header {
        display: flex;
        height: 1.75rem;
        align-items: center;
        gap: 0.125rem;
        margin-top: 0.25rem;
        color: var(--color-sidebar-foreground);
    }

    :global(.explorer-group-toggle) {
        display: flex;
        min-width: 0;
        height: 1.75rem;
        flex: 1 1 0%;
        align-items: center;
        gap: 0.25rem;
        overflow: hidden;
        border: 0;
        border-radius: var(--radius-sm);
        background-color: transparent;
        padding-inline: 0.25rem;
        color: inherit;
        font-size: 0.875rem;
        font-weight: 600;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    :global(.explorer-group-toggle:hover) {
        background-color: var(--color-workbench-hover);
    }

    :global(.explorer-group-toggle svg) {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
    }

    .group-name {
        min-width: 0;
        flex: 1 1 0%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    :global([data-slot="input"].explorer-group-rename-input) {
        width: auto;
        min-width: 0;
        height: 1.75rem;
        flex: 1 1 0%;
        border-radius: var(--radius-sm);
        font-size: 0.75rem;
        font-weight: 600;
    }

    :global([data-slot="button"].explorer-group-confirm),
    :global([data-slot="button"].explorer-group-rename),
    :global(.explorer-group-menu-trigger) {
        width: 1.75rem;
        height: 1.75rem;
        flex-shrink: 0;
        border-radius: var(--radius-sm);
    }

    :global([data-slot="button"].explorer-group-rename),
    :global(.explorer-group-menu-trigger) {
        opacity: 0;
    }

    .group-header:hover :global([data-slot="button"].explorer-group-rename),
    .group-header:focus-within :global([data-slot="button"].explorer-group-rename),
    .group-header:hover :global(.explorer-group-menu-trigger),
    .group-header:focus-within :global(.explorer-group-menu-trigger),
    :global(.explorer-group-menu-trigger[aria-expanded="true"]) {
        opacity: 1;
    }

    :global([data-slot="button"].explorer-group-rename svg) {
        width: 0.875rem;
        height: 0.875rem;
    }

    :global(.explorer-group-menu-trigger) {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid transparent;
        background-color: transparent;
        color: inherit;
        outline: none;
        transition: color 150ms, background-color 150ms, box-shadow 150ms,
            opacity 150ms;
        user-select: none;
    }

    :global(.explorer-group-menu-trigger:hover) {
        background-color: color-mix(in oklab, var(--color-muted) 50%, transparent);
        color: var(--color-foreground);
    }

    :global(.explorer-group-menu-trigger[aria-expanded="true"]) {
        background-color: var(--color-muted);
        color: var(--color-foreground);
    }

    :global(.explorer-group-menu-trigger:focus-visible) {
        border-color: var(--color-ring);
        box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-ring) 50%, transparent);
    }

    :global(.explorer-group-menu-trigger svg) {
        pointer-events: none;
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
    }
</style>

{#snippet GroupConfirmDeleteDialog(groupName: string)}
    <Dialog.Root bind:open={deleteOpen}>
        <Dialog.Content>
            <Dialog.Header>
                <Dialog.Title>Delete Group?</Dialog.Title>
                <Dialog.Description>
                    Are you sure you want to delete group "{groupName}"? This action cannot be undone.
                </Dialog.Description>
            </Dialog.Header>
            <Dialog.Footer>
                <Button variant="outline" onclick={() => deleteOpen = false}>Cancel</Button>
                <Button
                    variant="destructive"
                    onclick={() => {
                        deleteGroup(groupName);
                        deleteOpen = false;
                    }}>Delete</Button>
            </Dialog.Footer>
        </Dialog.Content>
    </Dialog.Root>
{/snippet}
