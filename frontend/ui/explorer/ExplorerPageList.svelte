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

    import { Pin } from "@lucide/svelte/icons";

    import { currentUrl } from "@/core/uiState.svelte";
    import * as ctxKeys from "@/core/context";
    const navigateTo = ctxKeys.navigateTo.get();

    import type { Page } from "@/core/data";
    const props: { pages: Page[] } = $props();
    const pages = $derived(_.sortBy(props.pages, p => p.sortKey));
</script>

<div class="flex flex-col gap-0.5">
    {#each pages as page (page.url)}
        <div class="flex flex-row gap-1">
            {@render PageItemRenderer(page)}
        </div>
    {/each}
</div>

{#snippet PageItemRenderer(page: Page)}
    <div
        class={["group/page flex w-full h-6 rounded-sm hover:bg-input/50", {
            "bg-input hover:bg-input shadow-sm":
                page.url === currentUrl.value,
        }]}>
        <button
            onclick={() => navigateTo(page.url)}
            class={["flex-1 inline-flex px-1.5 truncate font-mono", {
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
                class={["inline-flex h-6 aspect-square items-center justify-center", {
                    "invisible group-hover/page:visible text-foreground/50":
                        !page.pinned
                }]}>
                <Pin size={12}/>
            </button>
        {/if}
    </div>
{/snippet}

