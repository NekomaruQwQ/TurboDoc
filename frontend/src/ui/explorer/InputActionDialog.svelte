<script lang="ts">
    import type { ProviderAction } from "@/core/data";

    import { Button } from "@shadcn/components/ui/button";
    import { Input } from "@shadcn/components/ui/input";
    import * as Dialog from "@shadcn/components/ui/dialog";

    import Icon from "@/ui/common/Icon.svelte";

    /** Generic dialog rendered for every `"input"` ProviderAction. The
     *  textarea/input is read on submit only — no `bind:value`, no
     *  per-keystroke reactivity. After submission the field clears. */
    let {
        action,
        open = $bindable(false),
        showTrigger = true,
    }: {
        action: Extract<ProviderAction, { type: "input" }>;
        /** Controlled open state used when another component owns the trigger. */
        open?: boolean;
        /** Preserve the legacy provider-action button outside a combobox. */
        showTrigger?: boolean;
    } = $props();

    let textareaEl: HTMLTextAreaElement | undefined = $state();
    let inputEl: HTMLInputElement | undefined = $state();

    function submit() {
        const value = action.multiline
            ? textareaEl?.value ?? ""
            : inputEl?.value ?? "";
        action.invoke(value);
        if (textareaEl) textareaEl.value = "";
        if (inputEl) inputEl.value = "";
        open = false;
    }
</script>

{#if showTrigger}
    <Button
        variant="outline"
        class="explorer-input-action-trigger"
        onclick={() => open = true}>
        <Icon icon={action.icon} size="sm" />
        <span>{action.name}</span>
    </Button>
{/if}

<Dialog.Root bind:open>
    <Dialog.Content>
        <Dialog.Header>
            <Dialog.Title>{action.dialogTitle}</Dialog.Title>
            <Dialog.Description>{action.dialogDescription}</Dialog.Description>
        </Dialog.Header>
        {#if action.multiline}
            <textarea
                bind:this={textareaEl}
                placeholder={action.placeholder ?? ""}
                rows={8}
                class="action-input"
            ></textarea>
        {:else}
            <Input bind:ref={inputEl} placeholder={action.placeholder ?? ""} />
        {/if}
        <Dialog.Footer>
            <Button variant="outline" onclick={() => open = false}>Cancel</Button>
            <Button onclick={submit}>{action.confirmLabel ?? "OK"}</Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>

<style>
    :global([data-slot="button"].explorer-input-action-trigger) {
        width: 100%;
        height: 1.75rem;
        justify-content: flex-start;
        margin-bottom: 0.25rem;
        border-color: var(--color-workbench-divider);
        border-radius: var(--radius-sm);
        background-color: transparent;
        padding-inline: 0.5rem;
        font-size: 0.75rem;
        font-weight: 400;
    }

    .action-input {
        width: 100%;
        border: 1px solid var(--color-input);
        border-radius: var(--radius-md);
        background-color: transparent;
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
    }

    .action-input::placeholder {
        color: var(--color-muted-foreground);
    }

    .action-input:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--color-ring);
    }
</style>
