<script lang="ts" module>
    import type { IdentType } from "@/core/data";

    const IDENT_COLOR: Record<IdentType, string> = {
        constant:  "text-[var(--color-orange)]",
        function:  "text-[var(--color-blue)]",
        interface: "text-[var(--color-cyan)]",
        macro:     "text-[var(--color-orange)]",
        namespace: "",
        type:      "text-[var(--color-yellow)]",
        unknown:   "",
    };
</script>

<script lang="ts">
    import * as _ from "remeda";

    import Pin from "@lucide/svelte/icons/pin";

    import { currentUrl } from "@/core/uiState.svelte";
    import * as ctx from "@/core/context.svelte";
    const navigateTo = ctx.navigateTo;

    import type { Page } from "@/core/data";
    const props: { pages: Page[] } = $props();
    const pages = $derived(_.sortBy(props.pages, p => p.sortKey));
</script>

<div class="flex flex-col">
    {#each pages as page (page.url)}
        <div class="flex min-w-0">
            {@render PageItemRenderer(page)}
        </div>
    {/each}
</div>

{#snippet PageItemRenderer(page: Page)}
    <div
        class={["group/page flex h-5 w-full rounded-sm text-xs text-muted-foreground transition-colors duration-75 hover:bg-workbench-hover hover:text-foreground", {
            "bg-workbench-selection text-foreground hover:bg-workbench-selection":
                page.url === currentUrl.value,
        }]}>
        <button
            onclick={() => navigateTo(page.url)}
            class={["inline-flex min-w-0 flex-1 items-center truncate rounded-sm px-1.5 text-left font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring", {
                "italic": page.pinned === false,
            }]}>
            {#if page.name.type === "symbol"}
                {#each page.name.path as ident, i (i)}
                    {#if i > 0}<span>{page.name.separator}</span>{/if}
                    <span class={IDENT_COLOR[ident.type]}>{ident.name}</span>
                {/each}
            {:else}
                {page.name.text}
            {/if}
        </button>
        {#if page.pinned !== null}
            <button
                onclick={e => { page.setPinned(!page.pinned); e.stopPropagation(); }}
                class={["inline-flex h-5 aspect-square items-center justify-center rounded-sm text-foreground/70 hover:bg-input/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring", {
                    "opacity-0 group-hover/page:opacity-100 group-focus-within/page:opacity-100":
                        !page.pinned
                }]}>
                <Pin size={12}/>
            </button>
        {/if}
    </div>
{/snippet}
