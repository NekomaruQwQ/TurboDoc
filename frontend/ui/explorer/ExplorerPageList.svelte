<script lang="ts">
    import Pin from "@lucide/svelte/icons/pin";

    import * as _ from "remeda";

    import type { IdentType, Page } from "@/core/data";
    import * as ctxKeys from "@/core/context";
    import { currentUrl } from "@/core/uiState.svelte";

    let { pages }: { pages: Page[] } = $props();

    const navigate = ctxKeys.navigateTo.get();

    function getIdentColor(type: IdentType): string {
        switch (type) {
            case "type":      return "text-[var(--color-yellow)]";
            case "interface": return "text-[var(--color-cyan)]";
            case "function":  return "text-[var(--color-blue)]";
            case "macro":
            case "constant":  return "text-[var(--color-orange)]";
            case "namespace":
            case "unknown":   return "";
        }
    }

    const sortedPages = $derived(_.sortBy(pages, p => p.sortKey));
</script>

<div class="flex flex-col gap-0.5">
    {#each sortedPages as page (page.url)}
        {@const active = page.url === currentUrl.value}
        {@const pinned = page.pinned === true}
        {@const italic = page.pinned === false}
        <div
            class={[
                "group/page flex items-center rounded-2xl w-full px-1 cursor-pointer border",
                active ? "bg-input shadow-sm" : "border-transparent hover:bg-input/50",
                italic && "italic",
            ]}
            onclick={() => navigate(page.url)}>
            <span class="flex-1 px-0.5 truncate font-mono font-light">
                {#if page.name.type === "text"}
                    {page.name.text}
                {:else}
                    {#each page.name.path as ident, i (i)}
                        {#if i > 0}<span>{page.name.separator}</span>{/if}
                        <span class={getIdentColor(ident.type)}>{ident.name}</span>
                    {/each}
                {/if}
            </span>
            {#if pinned}
                <span
                    onclick={(e: MouseEvent) => {
                        page.setPinned(false);
                        e.stopPropagation();
                    }}>
                    <Pin size={12} />
                </span>
            {:else if italic}
                <span
                    class="invisible group-hover/page:visible"
                    onclick={(e: MouseEvent) => {
                        page.setPinned(true);
                        e.stopPropagation();
                    }}>
                    <Pin size={12} class="text-foreground/50" />
                </span>
            {/if}
        </div>
    {/each}
</div>
