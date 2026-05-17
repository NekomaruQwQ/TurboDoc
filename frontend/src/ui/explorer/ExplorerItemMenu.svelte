<script lang="ts">
    import { cn } from "@shadcn/utils";
    import { buttonVariants } from "@shadcn/components/ui/button";

    import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
    import ExternalLink from "@lucide/svelte/icons/external-link";
    import LogIn from "@lucide/svelte/icons/log-in";

    import type { Item, ItemAction, ProviderData } from "@/core/data";
    import * as DropdownMenu from "@shadcn/components/ui/dropdown-menu";
    import Icon from "@/ui/common/Icon.svelte";

    import * as ctxKeys from "@/core/context";

    let { item, itemGroupName }: { item: Item; itemGroupName: string } = $props();

    const navigate = ctxKeys.navigateTo.get();
    const store = ctxKeys.providerData.get();

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

<DropdownMenu.Root>
    <DropdownMenu.Trigger
        class={cn(buttonVariants({ variant: "outline" }), "size-6")}
        aria-label="Item actions">
        <EllipsisVertical class="size-3.5" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content class="min-w-42">
        <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>
                <LogIn class="size-3.5" />
                <span>Move to group</span>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent>
                <DropdownMenu.Item
                    disabled={moveToUngroupedAction.disabled}
                    onSelect={() => moveToUngroupedAction.invoke()}>
                    {moveToUngroupedAction.name}
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                {#each moveActions as action (action.name)}
                    <DropdownMenu.Item
                        disabled={action.disabled}
                        onSelect={() => action.invoke()}>
                        {action.name}
                    </DropdownMenu.Item>
                {/each}
            </DropdownMenu.SubContent>
        </DropdownMenu.Sub>

        {#if item.links && item.links.length > 0}
            <DropdownMenu.Separator />
            {#each item.links as link (link.name)}
                <DropdownMenu.Item onSelect={() => navigate(link.url)}>
                    <Icon icon={link.icon ?? defaultLinkIcon} size="sm" />
                    <span>{link.name}</span>
                </DropdownMenu.Item>
            {/each}
        {/if}

        {#if item.actions && item.actions.length > 0}
            <DropdownMenu.Separator />
            {#each item.actions as action (action.name)}
                <DropdownMenu.Item
                    variant={action.destructive ? "destructive" : undefined}
                    disabled={action.disabled}
                    onSelect={() => action.invoke()}>
                    {#if action.icon}<Icon icon={action.icon} size="sm" />{/if}
                    <span>{action.name}</span>
                </DropdownMenu.Item>
            {/each}
        {/if}
    </DropdownMenu.Content>
</DropdownMenu.Root>
