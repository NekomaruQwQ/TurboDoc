<script lang="ts">
    import Check from "@lucide/svelte/icons/check";
    import Plus from "@lucide/svelte/icons/plus";

    import { Button } from "@shadcn/components/ui/button";
    import { Input } from "@shadcn/components/ui/input";

    import * as ctxKeys from "@/core/context";
    import { expandGroup } from "@/core/uiState.svelte";

    const provider = ctxKeys.provider.get();
    const store = ctxKeys.providerData.get();

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

<div class="flex flex-row items-center w-full gap-1">
    {#if inputMode}
        <Input
            bind:value={inputText}
            placeholder="Group name..."
            class="h-8 flex-1 ml-1"
            onkeydown={e => {
                if (e.key === "Enter") ok();
                else if (e.key === "Escape") cancel();
            }}
            onblur={cancel} />
        <!-- onmousedown so the click registers before the Input's onblur. -->
        <Button
            variant="secondary"
            size="icon"
            class="size-8 border cursor-pointer"
            onmousedown={ok}>
            <Check />
        </Button>
    {:else}
        <Button
            variant="secondary"
            class="w-full h-8 border cursor-pointer"
            onclick={() => inputMode = true}>
            <Plus />
            <span>Add Group</span>
        </Button>
    {/if}
</div>
