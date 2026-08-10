<script lang="ts">
    import { onDestroy } from "svelte";

    import Ellipsis from "@lucide/svelte/icons/ellipsis";
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import ChevronRight from "@lucide/svelte/icons/chevron-right";
    import LoaderCircle from "@lucide/svelte/icons/loader-circle";
    import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

    import type { Item, ItemVersions } from "@/core/data";

    import * as Collapsible from "@shadcn/components/ui/collapsible";
    import * as Select from "@shadcn/components/ui/select";

    import * as ctx from "@/core/context.svelte";
    import { itemExpanded } from "@/core/uiState.svelte";

    import ExplorerItemMenu from "@/ui/explorer/ExplorerItemMenu.svelte";
    import ExplorerPageList from "@/ui/explorer/ExplorerPageList.svelte";

    let { item, itemGroupName }: { item: Item; itemGroupName: string } = $props();

    const provider = ctx.getProviderInfo();
    const expanded = $derived(itemExpanded(provider.id, item.id));

    // A short delay filters incidental pointer travel across a long crate
    // list. Keyboard focus and explicit activation load immediately because
    // they are stronger intent signals.
    const HOVER_INTENT_DELAY_MS = 125;
    let pointerInside = $state(false);
    let focusInside = $state(false);
    let versionSelectOpen = $state(false);
    let openVersionSelectWhenReady = $state(false);
    let hoverIntentTimer: ReturnType<typeof setTimeout> | null = null;
    const versionSelectorVisible =
        $derived(pointerInside || focusInside || versionSelectOpen);

    function cancelHoverIntent() {
        if (hoverIntentTimer === null) return;
        clearTimeout(hoverIntentTimer);
        hoverIntentTimer = null;
    }

    function loadVersionMetadataNow() {
        cancelHoverIntent();
        item.versions?.ensureLoaded?.();
    }

    /** Explicit activation should complete as one interaction: once the
     * asynchronous choices arrive, open the real selector automatically. */
    function activateVersionSelector() {
        openVersionSelectWhenReady = true;
        loadVersionMetadataNow();
    }

    function scheduleVersionMetadataLoad() {
        const versions = item.versions;
        if (!versions?.ensureLoaded ||
            versions.status === "ready" ||
            versions.status === "loading" ||
            hoverIntentTimer !== null) return;
        hoverIntentTimer = setTimeout(() => {
            hoverIntentTimer = null;
            versions.ensureLoaded?.();
        }, HOVER_INTENT_DELAY_MS);
    }

    function handlePointerEnter(event: PointerEvent) {
        pointerInside = true;
        if (event.pointerType === "mouse") {
            scheduleVersionMetadataLoad();
        } else {
            loadVersionMetadataNow();
        }
    }

    function handlePointerLeave() {
        pointerInside = false;
        cancelHoverIntent();
    }

    function handleFocusIn() {
        focusInside = true;
        loadVersionMetadataNow();
    }

    function handleFocusOut(event: FocusEvent) {
        const next = event.relatedTarget;
        const card = event.currentTarget as HTMLDivElement;
        if (!(next instanceof Node) || !card.contains(next)) focusInside = false;
    }

    $effect(() => {
        if (!openVersionSelectWhenReady) return;
        switch (item.versions?.status) {
            case "ready":
                openVersionSelectWhenReady = false;
                versionSelectOpen = true;
                break;
            case "error":
                openVersionSelectWhenReady = false;
                break;
        }
    });

    onDestroy(cancelHoverIntent);
</script>

<Collapsible.Root
    class="flex flex-col truncate"
    data-explorer-item-id={item.id}
    open={expanded.value}
    onOpenChange={v => expanded.value = v}
    role="group"
    aria-label={`${item.name} crate`}
    onpointerenter={handlePointerEnter}
    onpointerleave={handlePointerLeave}
    onfocusin={handleFocusIn}
    onfocusout={handleFocusOut}>
    <div
        data-explorer-item-header
        class="group/item flex h-7 min-w-0 items-center rounded-sm px-0.5 hover:bg-workbench-hover focus-within:bg-workbench-hover">
        <Collapsible.Trigger
            class="flex h-7 min-w-0 flex-1 items-center gap-1 pl-1.5 text-left font-mono text-[13px]">
            {#if expanded.value}
                <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
            {:else}
                <ChevronRight class="size-3.5 shrink-0 text-muted-foreground" />
            {/if}
            <span class="truncate">{item.name}</span>
        </Collapsible.Trigger>
        {#if item.versions}
            <div
                class={[
                    "version-control w-21 shrink-0 transition-opacity duration-75",
                    versionSelectorVisible
                        ? "pointer-events-auto opacity-100"
                        : "pointer-events-none opacity-0",
                ]}>
                {@render ExplorerItemVersionSelect(item.versions)}
            </div>
        {/if}
        <ExplorerItemMenu {item} {itemGroupName} />
    </div>
    <Collapsible.Content class="flex flex-col pl-5">
        <ExplorerPageList pages={item.pages} />
    </Collapsible.Content>
</Collapsible.Root>

{#snippet ExplorerItemVersionSelect(versions: ItemVersions)}
    {#if versions.status === "ready"}
        <Select.Root
            type="single"
            value={versions.current}
            bind:open={versionSelectOpen}
            onValueChange={versions.setCurrentVersion}>
            <Select.Trigger
                size="sm"
                class="h-5! w-21 rounded-sm border-transparent bg-transparent py-0 pr-1 pl-1.5 text-[11px] text-muted-foreground shadow-none hover:border-input hover:bg-input/30">
                {versions.current}
            </Select.Trigger>
            <Select.Content>
                {#each versions.recommended as version (version)}
                    <Select.Item value={version} class="h-7 px-2 text-xs">
                        {version}
                    </Select.Item>
                {/each}
                <Select.Separator class="m-0.5" />
                <!-- Placeholder for future full version list popup. -->
                <Select.Item value="..." disabled class="h-7 px-2 text-xs">
                    <Ellipsis class="mr-1 inline" />
                    <span>More versions</span>
                </Select.Item>
            </Select.Content>
        </Select.Root>
    {:else}
        <button
            type="button"
            class="flex h-5 w-21 items-center gap-1 rounded-sm border border-transparent bg-transparent py-0 pr-1 pl-1.5 text-left text-[11px] text-muted-foreground hover:border-input hover:bg-input/30"
            aria-busy={versions.status === "loading"}
            aria-label={versions.status === "error"
                ? `Retry loading versions for ${item.name}`
                : `Load versions for ${item.name}`}
            title={versions.error}
            onclick={activateVersionSelector}>
            <span class="min-w-0 flex-1 truncate">{versions.current}</span>
            {#if versions.status === "loading"}
                <LoaderCircle class="size-3 shrink-0 animate-spin" />
            {:else if versions.status === "error"}
                <TriangleAlert class="size-3 shrink-0 text-destructive" />
            {/if}
        </button>
    {/if}
{/snippet}

<style>
    /* Hover-only controls must remain reachable on devices that cannot
       express hover. A coarse/touch pointer gets the same stable footprint
       and interaction without requiring a sacrificial first tap. */
    @media (hover: none) {
        .version-control {
            opacity: 1;
            pointer-events: auto;
        }
    }
</style>
