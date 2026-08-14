<script lang="ts">
    import Check from "@lucide/svelte/icons/check";
    import Plus from "@lucide/svelte/icons/plus";

    import { Button } from "@shadcn/components/ui/button";
    import { Input } from "@shadcn/components/ui/input";

    import * as ctx from "@/core/context.svelte";
    import { expandGroup } from "@/core/uiState.svelte";

    const provider = ctx.getProviderInfo();
    const store = ctx.getProviderData();

    let inputMode = $state(false);
    let inputText = $state("");

    function createGroup(name: string) {
        if (!name || name in store.data.groups) return;
        store.data.groups[name] = { items: [] };
        store.data.groupOrder.push(name);
        // Auto-expand newly created group.
        expandGroup(provider.id, name);
    }

    function ok() {
        createGroup(inputText.trim());
        inputText = "";
        inputMode = false;
    }

    function cancel() {
        inputText = "";
        inputMode = false;
    }
</script>

<div class="create-group">
    {#if inputMode}
        <Input
            bind:value={inputText}
            placeholder="Group name..."
            class="explorer-create-group-input"
            onkeydown={e => {
                if (e.key === "Enter") ok();
                else if (e.key === "Escape") cancel();
            }}
            onblur={cancel} />
        <!-- onmousedown so the click registers before the Input's onblur. -->
        <Button
            variant="ghost"
            class="explorer-create-group-confirm"
            aria-label="Create group"
            onmousedown={ok}>
            <Check />
        </Button>
    {:else}
        <Button
            variant="ghost"
            class="explorer-create-group-action"
            onclick={() => inputMode = true}>
            <Plus />
            <span>Add Group</span>
        </Button>
    {/if}
</div>

<style>
    .create-group {
        display: flex;
        width: 100%;
        align-items: center;
        gap: 0.25rem;
    }

    :global([data-slot="input"].explorer-create-group-input) {
        width: auto;
        min-width: 0;
        height: 1.75rem;
        flex: 1 1 0%;
        border-radius: var(--radius-sm);
        font-size: 0.75rem;
    }

    :global([data-slot="button"].explorer-create-group-confirm) {
        width: 1.75rem;
        height: 1.75rem;
        flex-shrink: 0;
        border-color: var(--color-workbench-divider);
        border-radius: var(--radius-sm);
    }

    :global([data-slot="button"].explorer-create-group-action) {
        width: 100%;
        height: 1.75rem;
        justify-content: flex-start;
        border-color: transparent;
        border-radius: var(--radius-sm);
        padding-inline: 0.5rem;
        color: var(--color-muted-foreground);
        font-size: 0.75rem;
        font-weight: 400;
    }

    :global([data-slot="button"].explorer-create-group-action:hover) {
        border-color: var(--color-workbench-divider);
        color: var(--color-foreground);
    }
</style>
