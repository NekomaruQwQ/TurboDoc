<script lang="ts">
    import BookOpenText from "@lucide/svelte/icons/book-open-text";
    import Globe2 from "@lucide/svelte/icons/globe-2";

    import { currentUrl } from "@/core/uiState.svelte";

    /** The navigation event is the source of truth after mount. Keeping this
     * label read-only avoids implying that arbitrary URL entry is supported. */
    const location = $derived(currentUrl.value || "No documentation selected");
</script>

<header
    class="grid h-10 shrink-0 grid-cols-[minmax(7rem,1fr)_minmax(16rem,44rem)_minmax(7rem,1fr)] items-center gap-3 border-b border-workbench-divider bg-background px-3">
    <div class="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
        <BookOpenText class="size-4 text-primary" />
        <span class="truncate">TurboDoc</span>
    </div>

    <div
        class="flex h-7 min-w-0 items-center justify-center gap-2 rounded-md border border-workbench-divider bg-workbench px-3 text-xs text-muted-foreground shadow-sm"
        title={location}>
        <Globe2 class="size-3.5 shrink-0" />
        <span class="truncate">{location}</span>
    </div>

    <!-- Symmetric outer columns keep the location centered as the window grows. -->
    <div aria-hidden="true"></div>
</header>
