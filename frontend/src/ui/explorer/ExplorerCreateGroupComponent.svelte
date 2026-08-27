<script lang="ts">
    import { tick } from "svelte";
    import Check from "@lucide/svelte/icons/check";
    import Plus from "@lucide/svelte/icons/plus";

    import { Button } from "@shadcn/components/ui/button";
    import { Input } from "@shadcn/components/ui/input";

    import * as ctx from "@/core/context.svelte";
    import { expandGroup } from "@/core/uiState.svelte";

    const topic = ctx.getTopic();
    const topicData = ctx.getExplorerWorkspace().topicData(topic.id);

    let inputMode = $state(false);
    let inputText = $state("");
    let inputElement: HTMLInputElement | undefined = $state();

    /** Enter creation mode and focus its conditionally rendered input. */
    async function beginCreatingGroup(): Promise<void> {
        inputMode = true;
        await tick();
        inputElement?.focus();
    }

    function createGroup(name: string) {
        if (!name || name in topicData.groups) return;
        topicData.groups[name] = { items: [] };
        topicData.groupOrder.push(name);
        // Auto-expand newly created group.
        expandGroup(topic.id, name);
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
            bind:ref={inputElement}
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
            onclick={beginCreatingGroup}>
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
