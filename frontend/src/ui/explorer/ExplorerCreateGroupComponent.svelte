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

<div class="flex w-full items-center gap-1">
    {#if inputMode}
        <Input
            bind:value={inputText}
            placeholder="Group name..."
            class="h-7 flex-1 rounded-sm text-xs"
            onkeydown={e => {
                if (e.key === "Enter") ok();
                else if (e.key === "Escape") cancel();
            }}
            onblur={cancel} />
        <!-- onmousedown so the click registers before the Input's onblur. -->
        <Button
            variant="ghost"
            class="size-7 rounded-sm border border-workbench-divider"
            onmousedown={ok}>
            <Check />
        </Button>
    {:else}
        <Button
            variant="ghost"
            class="h-7 w-full justify-start rounded-sm border border-transparent px-2 text-xs font-normal text-muted-foreground hover:border-workbench-divider hover:text-foreground"
            onclick={() => inputMode = true}>
            <Plus />
            <span>Add Group</span>
        </Button>
    {/if}
</div>
