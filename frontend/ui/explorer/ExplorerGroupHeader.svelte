<script lang="ts" module>
    export const OUTER_STYLE =
        "flex flex-row h-8 my-1 gap-0.5 " +
        "items-center text-muted-foreground";
    export const INNER_STYLE =
        "flex flex-row flex-1 gap-2 pl-1 " +
        "items-center font-semibold text-lg text-left truncate";
</script>

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

    import { cn } from "@/3rdparty/shadcn/utils";
    import { Button, buttonVariants } from "@shadcn/components/ui/button";
    import { Input } from "@shadcn/components/ui/input";
    import * as Dialog from "@shadcn/components/ui/dialog";
    import * as DropdownMenu from "@shadcn/components/ui/dropdown-menu";

    import * as ctxKeys from "@/core/context";
    import { expandItems, collapseItems, removeGroup, renameGroup, groupExpanded } from "@/core/uiState.svelte";

    let { groupName }: { groupName: string } = $props();

    const provider = ctxKeys.provider.get();
    const store = ctxKeys.providerData.get();

    let deleteOpen = $state(false);
    let renaming = $state(false);
    let renameValue = $state("");

    const expanded =
        $derived(groupExpanded(provider.id, groupName));
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

    function expandAll(groupName: string) {
        expandItems(provider.id, store.data.groups[groupName]?.items ?? []);
    }

    function collapseAll(groupName: string) {
        collapseItems(provider.id, store.data.groups[groupName]?.items ?? []);
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
    <div class={OUTER_STYLE}>
        <!-- Inline rename input. Confirms on Enter, cancels on Escape or blur. -->
        <Input
            bind:value={renameValue}
            class="flex-1 h-8 font-semibold"
            onkeydown={e => {
                if (e.key === "Enter") confirmRename(groupName);
                else if (e.key === "Escape") renaming = false;
            }}
            onblur={() => confirmRename(groupName)} />
        <Button
            variant="secondary"
            class="size-8"
            onclick={() => confirmRename(groupName)}>
            <Check />
        </Button>
    </div>
{:else}
    <div class={`group/header ${OUTER_STYLE}`}>
        <button
            class={INNER_STYLE}
            onclick={() => expanded && (expanded.value = !expanded.value)}>
            {#if expanded?.value}
                <ChevronDown class="size-4" />
            {:else}
                <ChevronRight class="size-4" />
            {/if}
            <span class="flex-1 truncate">{groupName}</span>
        </button>

        <!-- Rename pencil; visible on header hover. -->
        <Button
            variant="ghost"
            class="size-8 rounded-md invisible group-hover/header:visible"
            aria-label="Rename group"
            onclick={() => startRename(groupName)}>
            <Pencil />
        </Button>

        <!-- Group dropdown menu: expand/collapse all, move ops, delete. -->
        {@render GroupMenu(groupName, isFirst, isLast, otherGroups)}

        <!-- Delete confirmation. -->
        {@render GroupConfirmDeleteDialog(groupName)}
    </div>
{/if}

{#snippet GroupMenu(
    groupName: string,
    isFirst: boolean,
    isLast: boolean,
    otherGroups: string[])}
    <!-- Group dropdown menu: expand/collapse all, move ops, delete. -->
    <DropdownMenu.Root>
        <DropdownMenu.Trigger
            class={cn(
                buttonVariants({ variant: "ghost" }),
                "size-8 invisible group-hover/header:visible")}
            aria-label="Group actions">
            <EllipsisVertical class="size-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
            <DropdownMenu.Item onSelect={() => expandAll(groupName)}>
                <ChevronsDown />
                <span>Expand All</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => collapseAll(groupName)}>
                <ChevronsUp />
                <span>Collapse All</span>
            </DropdownMenu.Item>
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
        </DropdownMenu.Content>
    </DropdownMenu.Root>
{/snippet}

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
