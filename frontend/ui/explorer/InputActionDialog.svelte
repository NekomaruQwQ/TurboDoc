<script lang="ts">
    import type { ProviderAction } from "@/core/data";

    import { Button } from "@shadcn/components/ui/button";
    import { Input } from "@shadcn/components/ui/input";
    import * as Dialog from "@shadcn/components/ui/dialog";

    import Icon from "@/ui/common/Icon.svelte";

    /** Generic dialog rendered for every `"input"` ProviderAction. The
     *  textarea/input is read on submit only — no `bind:value`, no
     *  per-keystroke reactivity. After submission the field clears. */
    let { action }: {
        action: Extract<ProviderAction, { type: "input" }>;
    } = $props();

    let open = $state(false);
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

<Button
    variant="secondary"
    class="w-full h-8 border cursor-pointer"
    onclick={() => open = true}>
    <Icon icon={action.icon} size="sm" />
    <span>{action.name}</span>
</Button>

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
                class="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
