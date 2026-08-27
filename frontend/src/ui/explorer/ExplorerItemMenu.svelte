<script lang="ts">
    import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
    import Ellipsis from "@lucide/svelte/icons/ellipsis";
    import ExternalLink from "@lucide/svelte/icons/external-link";
    import LoaderCircle from "@lucide/svelte/icons/loader-circle";
    import LogIn from "@lucide/svelte/icons/log-in";
    import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

    import type { ExplorerItem, ItemAction, ItemVersions } from "@/core/explorer";
    import type { ExplorerTopicData } from "@/core/explorerWorkspaceStore.svelte";
    import * as DropdownMenu from "@shadcn/components/ui/dropdown-menu";
    import Icon from "@/ui/common/Icon.svelte";
    import {
        buildVersionMenuChoices,
        type VersionMenuChoices,
    } from "@/ui/explorer/version-menu";

    import * as ctx from "@/core/context.svelte";

    let { item, itemGroupName }: { item: ExplorerItem; itemGroupName: string } = $props();

    const navigate = ctx.navigateTo;
    const topic = ctx.getTopic();
    const topicData = ctx.getExplorerWorkspace().topicData(topic.id);
    const versionChoices = $derived(
        item.versions?.status === "ready"
            ? buildVersionMenuChoices(item.versions)
            : null);

    /** Opening the menu is the first point where its version choices become
     * visible, so it is also the adapter-neutral lazy-loading intent. */
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
                applyMove(topicData, item.id, itemGroupName, targetGroupName);
            },
        };
    }

    const moveToUngroupedAction = $derived(buildMoveAction("", "Ungrouped"));
    const moveActions = $derived(
        topicData.groupOrder
            .filter(name => name in topicData.groups)
            .map(name => buildMoveAction(name)));

    function applyMove(
        draft: ExplorerTopicData,
        itemId: ExplorerItem["id"],
        sourceGroup: string,
        targetGroup: string,
    ) {
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
        class="explorer-item-menu-trigger"
        aria-label={`Actions for ${item.name}`}>
        <EllipsisVertical />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content class="explorer-item-menu">
        <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>
                <LogIn class="explorer-item-menu-icon" />
                <span>Move to group</span>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent class="explorer-item-submenu">
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
            <DropdownMenu.Label>Links</DropdownMenu.Label>
            {#each item.links as link (link.name)}
                <DropdownMenu.Item onSelect={() => navigate(link.url)}>
                    <Icon size="xs" icon={link.icon ?? defaultLinkIcon} />
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
                    variant={action.destructive ? "destructive" : undefined}
                    disabled={action.disabled}
                    onSelect={() => action.invoke()}>
                    {#if action.icon}<Icon size="xs" icon={action.icon} />{/if}
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
                    value={version}>
                    {version}
                </DropdownMenu.RadioItem>
            {/each}
        </DropdownMenu.RadioGroup>

        {#if choices.overflowGroups.length > 0}
            <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger class="explorer-version-overflow-trigger">
                    <Ellipsis />
                    <span>More versions</span>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.SubContent
                    class="explorer-version-menu">
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
                                    value={version}>
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
                class="explorer-current-version"
                aria-busy={versions.status === "loading"}
                aria-label={versions.status === "error"
                    ? `Retry loading versions for ${item.name}; current version ${versions.current}`
                    : `Loading versions for ${item.name}; current version ${versions.current}`}
                title={versions.error}
                onSelect={() => versions.ensureLoaded?.()}>
                {#if versions.status === "loading"}
                    <LoaderCircle class="explorer-version-spinner" />
                {:else if versions.status === "error"}
                    <TriangleAlert class="explorer-version-error" />
                {/if}
                <span>{versions.current}</span>
            </DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
    {/if}
{/snippet}

<style>
    :global(.explorer-item-menu-trigger) {
        display: inline-flex;
        width: 1.5rem;
        height: 1.5rem;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        background-color: transparent;
        color: inherit;
        opacity: 0;
        outline: none;
        transition: color 150ms, background-color 150ms, border-color 150ms,
            box-shadow 150ms, opacity 150ms;
        user-select: none;
    }

    :global([data-explorer-item-header]:hover .explorer-item-menu-trigger),
    :global([data-explorer-item-header]:focus-within .explorer-item-menu-trigger),
    :global(.explorer-item-menu-trigger[aria-expanded="true"]) {
        opacity: 1;
    }

    :global(.explorer-item-menu-trigger:hover) {
        background-color: color-mix(in oklab, var(--color-muted) 50%, transparent);
        color: var(--color-foreground);
    }

    :global(.explorer-item-menu-trigger[aria-expanded="true"]) {
        background-color: var(--color-muted);
        color: var(--color-foreground);
    }

    :global(.explorer-item-menu-trigger:focus-visible) {
        border-color: var(--color-ring);
        box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-ring) 50%, transparent);
    }

    :global(.explorer-item-menu-trigger svg) {
        pointer-events: none;
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
    }

    :global([data-slot="dropdown-menu-content"].explorer-item-menu) {
        min-width: 10.5rem;
    }

    :global(.explorer-item-menu [data-slot="dropdown-menu-item"]),
    :global(.explorer-item-menu [data-slot="dropdown-menu-sub-trigger"]),
    :global(.explorer-item-menu [data-slot="dropdown-menu-radio-item"]),
    :global(.explorer-item-submenu [data-slot="dropdown-menu-item"]),
    :global(.explorer-version-menu [data-slot="dropdown-menu-radio-item"]) {
        font-size: 0.75rem;
    }

    :global(.explorer-item-menu-icon) {
        width: 0.75rem;
        height: 0.75rem;
    }

    :global([data-slot="dropdown-menu-sub-trigger"].explorer-version-overflow-trigger),
    :global([data-slot="dropdown-menu-radio-item"].explorer-current-version),
    :global(.explorer-version-menu [data-slot="dropdown-menu-radio-item"]) {
        height: 1.75rem;
        font-size: 0.75rem;
    }

    :global([data-slot="dropdown-menu-radio-item"].explorer-current-version),
    :global(.explorer-version-menu [data-slot="dropdown-menu-radio-item"]) {
        font-family: var(--font-mono);
    }

    :global([data-slot="dropdown-menu-sub-content"].explorer-version-menu) {
        min-width: 8rem;
        max-height: 20rem;
        overflow-y: auto;
    }

    :global(.explorer-version-spinner),
    :global(.explorer-version-error) {
        width: 0.75rem;
        height: 0.75rem;
    }

    :global(.explorer-version-spinner) {
        animation: version-spinner 1s linear infinite;
    }

    :global(.explorer-version-error) {
        color: var(--color-destructive);
    }

    @keyframes version-spinner {
        to { transform: rotate(360deg); }
    }

    @media (hover: none) {
        :global(.explorer-item-menu-trigger) { opacity: 1; }
    }

    @media (prefers-reduced-motion: reduce) {
        :global(.explorer-version-spinner) { animation: none; }
    }
</style>
