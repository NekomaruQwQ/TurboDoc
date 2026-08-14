<script lang="ts">
    import { cn } from "@shadcn/utils";
    import { buttonVariants } from "@shadcn/components/ui/button";

    import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
    import Ellipsis from "@lucide/svelte/icons/ellipsis";
    import ExternalLink from "@lucide/svelte/icons/external-link";
    import LoaderCircle from "@lucide/svelte/icons/loader-circle";
    import LogIn from "@lucide/svelte/icons/log-in";
    import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

    import type { Item, ItemAction, ItemVersions, ProviderData } from "@/core/data";
    import * as DropdownMenu from "@shadcn/components/ui/dropdown-menu";
    import Icon from "@/ui/common/Icon.svelte";
    import {
        buildVersionMenuChoices,
        type VersionMenuChoices,
    } from "@/ui/explorer/version-menu";

    import * as ctx from "@/core/context.svelte";

    let { item, itemGroupName }: { item: Item; itemGroupName: string } = $props();

    const navigate = ctx.navigateTo;
    const store = ctx.getProviderData();
    const versionChoices = $derived(
        item.versions?.status === "ready"
            ? buildVersionMenuChoices(item.versions)
            : null);

    /** Opening the menu is the first point where its version choices become
     * visible, so it is also the provider-neutral lazy-loading intent. */
    function handleMenuOpenChange(open: boolean) {
        if (open) item.versions?.ensureLoaded?.();
    }

    /** Build a ItemAction that moves this item from its current group to
     *  the given target group. Used both for the top-level "Ungrouped"
     *  entry and for each named group in the move-to submenu. */
    function buildMoveAction(targetGroupName: string, displayName?: string): ItemAction {
        return {
            name: displayName ?? targetGroupName,
            disabled: targetGroupName === itemGroupName || undefined,
            invoke() {
                if (targetGroupName === itemGroupName) return;
                applyMove(store.data as ProviderData, item.id, itemGroupName, targetGroupName);
            },
        };
    }

    const moveToUngroupedAction = $derived(buildMoveAction("", "Ungrouped"));
    const moveActions = $derived(
        store.data.groupOrder
            .filter(name => name in store.data.groups)
            .map(name => buildMoveAction(name)));

    function applyMove(draft: ProviderData, itemId: string, sourceGroup: string, targetGroup: string) {
        // Mirror the React version's two-phase validate/then-mutate pattern:
        // collect both source-side and target-side mutations, abort on any
        // missing group, then apply all at once. Keeps move operations atomic.
        const ops: (() => void)[] = [];
        if (sourceGroup) {
            const src = draft.groups[sourceGroup];
            if (!src) {
                console.warn(`Move ${itemId}: source group "${sourceGroup}" not found`);
                return;
            }
            const idx = src.items.indexOf(itemId);
            if (idx < 0) {
                console.warn(`Move ${itemId}: not present in source group "${sourceGroup}"`);
                return;
            }
            ops.push(() => src.items.splice(idx, 1));
        }
        if (targetGroup) {
            const tgt = draft.groups[targetGroup];
            if (!tgt) {
                console.warn(`Move ${itemId}: target group "${targetGroup}" not found`);
                return;
            }
            ops.push(() => {
                tgt.items.push(itemId);
                tgt.items.sort();
            });
        }
        for (const op of ops) op();
    }

    /** Default external-link icon (used for `ItemLink` entries that don't
     *  carry their own icon). */
    const defaultLinkIcon = { type: "lucide" as const, icon: ExternalLink };
</script>

<DropdownMenu.Root onOpenChange={handleMenuOpenChange}>
    <DropdownMenu.Trigger
        class={cn(
            buttonVariants({ variant: "ghost" }),
            "size-6 rounded-sm opacity-0 group-hover/item:opacity-100 " +
            "group-focus-within/item:opacity-100 aria-expanded:opacity-100 " +
            "[@media(hover:none)]:opacity-100")}
        aria-label={`Actions for ${item.name}`}>
        <EllipsisVertical />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content class="min-w-42">
        <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger class="text-xs">
                <LogIn class="size-3" />
                <span>Move to group</span>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent>
                <DropdownMenu.Item
                    class="text-xs"
                    disabled={moveToUngroupedAction.disabled}
                    onSelect={() => moveToUngroupedAction.invoke()}>
                    {moveToUngroupedAction.name}
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                {#each moveActions as action (action.name)}
                    <DropdownMenu.Item
                        class="text-xs"
                        disabled={action.disabled}
                        onSelect={() => action.invoke()}>
                        {action.name}
                    </DropdownMenu.Item>
                {/each}
            </DropdownMenu.SubContent>
        </DropdownMenu.Sub>

        {#if item.links && item.links.length > 0}
            <DropdownMenu.Separator />
            <DropdownMenu.Label>Links</DropdownMenu.Label>
            {#each item.links as link (link.name)}
                <DropdownMenu.Item class="text-xs" onSelect={() => navigate(link.url)}>
                    <Icon class="size-3" icon={link.icon ?? defaultLinkIcon} />
                    <span>{link.name}</span>
                </DropdownMenu.Item>
            {/each}
        {/if}

        {#if item.versions}
            <DropdownMenu.Separator />
            {@render ExplorerItemVersions(item.versions, versionChoices)}
        {/if}

        {#if item.actions && item.actions.length > 0}
            <DropdownMenu.Separator />
            {#each item.actions as action (action.name)}
                <DropdownMenu.Item
                    class="text-xs"
                    variant={action.destructive ? "destructive" : undefined}
                    disabled={action.disabled}
                    onSelect={() => action.invoke()}>
                    {#if action.icon}<Icon class="size-3" icon={action.icon} />{/if}
                    <span>{action.name}</span>
                </DropdownMenu.Item>
            {/each}
        {/if}
    </DropdownMenu.Content>
</DropdownMenu.Root>

{#snippet ExplorerItemVersions(
    versions: ItemVersions,
    choices: VersionMenuChoices | null,
)}
    <DropdownMenu.Label>Version</DropdownMenu.Label>
    {#if versions.status === "ready" && choices}
        <DropdownMenu.RadioGroup
            value={versions.current}
            onValueChange={versions.setCurrentVersion}
            aria-label={`Version for ${item.name}`}>
            {#each choices.direct as version (version)}
                <DropdownMenu.RadioItem
                    value={version}
                    class="text-xs">
                    {version}
                </DropdownMenu.RadioItem>
            {/each}
        </DropdownMenu.RadioGroup>

        {#if choices.overflowGroups.length > 0}
            <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger class="h-7 text-xs">
                    <Ellipsis />
                    <span>More versions</span>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.SubContent
                    class="max-h-80 min-w-32 overflow-y-auto">
                    {#each choices.overflowGroups as group, groupIndex}
                        {#if groupIndex > 0}
                            <DropdownMenu.Separator />
                        {/if}
                        <DropdownMenu.RadioGroup
                            value={versions.current}
                            onValueChange={versions.setCurrentVersion}
                            aria-label={`More versions for ${item.name}`}>
                            {#each group as version (version)}
                                <DropdownMenu.RadioItem
                                    value={version}
                                    class="h-7 font-mono text-xs">
                                    {version}
                                </DropdownMenu.RadioItem>
                            {/each}
                        </DropdownMenu.RadioGroup>
                    {/each}
                </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
        {/if}
    {:else}
        <DropdownMenu.RadioGroup
            value={versions.current}
            aria-label={`Current version for ${item.name}`}>
            <DropdownMenu.RadioItem
                value={versions.current}
                closeOnSelect={false}
                class="h-7 font-mono text-xs"
                aria-busy={versions.status === "loading"}
                aria-label={versions.status === "error"
                    ? `Retry loading versions for ${item.name}; current version ${versions.current}`
                    : `Loading versions for ${item.name}; current version ${versions.current}`}
                title={versions.error}
                onSelect={() => versions.ensureLoaded?.()}>
                {#if versions.status === "loading"}
                    <LoaderCircle class="size-3 animate-spin" />
                {:else if versions.status === "error"}
                    <TriangleAlert class="size-3 text-destructive" />
                {/if}
                <span>{versions.current}</span>
            </DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
    {/if}
{/snippet}
