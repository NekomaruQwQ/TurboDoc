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

    import * as ctxKeys from "@/core/context";
    import { expandItems, collapseItems, removeGroup, renameGroup, groupExpanded } from "@/core/uiState.svelte";

    type Props =
        | { variant: "ungrouped" }
        | { variant: "default"; groupName: string };
    let props: Props = $props();

    const provider = ctxKeys.provider.get();
    const store = ctxKeys.providerData.get();

    // Local UI state for the named-group case. (Always declared at top
    // level so the runes are statically discoverable; no-ops for the
    // "ungrouped" branch.)
    let deleteOpen = $state(false);
    let renaming = $state(false);
    let renameValue = $state("");

    // Reactive expansion accessor; only meaningful for variant="default".
    const expanded = $derived(
        props.variant === "default"
            ? groupExpanded(provider.id, props.variant === "default" ? props.groupName : "")
            : null);

    const isFirst = $derived(
        props.variant === "default"
            ? store.data.groupOrder[0] === props.groupName
            : false);
    const isLast = $derived(
        props.variant === "default"
            ? store.data.groupOrder[store.data.groupOrder.length - 1] === props.groupName
            : false);
    const otherGroups = $derived(
        props.variant === "default"
            ? store.data.groupOrder
                .filter(name => name in store.data.groups)
                .filter(name => name !== props.groupName)
            : []);

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

{#if props.variant === "ungrouped"}
    <div class="group/header flex flex-row h-8 py-0.5 items-center gap-0.5 text-muted-foreground">
        <p class="flex flex-row flex-1 gap-2 items-center text-lg pl-1 font-semibold cursor-pointer truncate">
            <span class="flex-1 truncate">Ungrouped</span>
        </p>
    </div>
{:else if renaming}
    <!-- Inline rename input. Confirms on Enter, cancels on Escape or blur. -->
    <div class="flex flex-row items-center h-8 py-0.5">
        <Input
            bind:value={renameValue}
            class="flex-1 h-7 mx-1 rounded-md font-semibold"
            onkeydown={e => {
                if (e.key === "Enter") confirmRename(props.variant === "default" ? props.groupName : "");
                else if (e.key === "Escape") renaming = false;
            }}
            onblur={() => confirmRename(props.variant === "default" ? props.groupName : "")} />
        <Button
            variant="secondary"
            size="icon-sm"
            class="rounded-md"
            onclick={() => confirmRename(props.variant === "default" ? props.groupName : "")}>
            <Check />
        </Button>
    </div>
{:else}
    {@const groupName = props.groupName}
    <div class="group/header flex flex-row h-8 py-0.5 items-center gap-0.5 text-muted-foreground">
        <p
            class="flex flex-row flex-1 gap-2 items-center text-lg pl-1 font-semibold cursor-pointer truncate"
            onclick={() => expanded && (expanded.value = !expanded.value)}>
            {#if expanded?.value}<ChevronDown size={14} />
            {:else}<ChevronRight size={14} />{/if}
            <span class="flex-1 truncate">{groupName}</span>
        </p>

        <!-- Rename pencil; visible on header hover. -->
        <Button
            variant="ghost"
            size="icon-sm"
            class="rounded-md invisible group-hover/header:visible"
            aria-label="Rename group"
            onclick={() => startRename(groupName)}>
            <Pencil />
        </Button>

        <!-- Group dropdown menu: expand/collapse all, move ops, delete. -->
        <DropdownMenu.Root>
            <DropdownMenu.Trigger
                class="size-7 rounded-md inline-flex items-center justify-center hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground transition-colors"
                aria-label="Group actions">
                <EllipsisVertical />
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
    </div>

    <!-- Delete confirmation. -->
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
{/if}
