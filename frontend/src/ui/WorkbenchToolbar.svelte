<script lang="ts">
    import BookOpenText from "@lucide/svelte/icons/book-open-text";
    import Globe2 from "@lucide/svelte/icons/globe-2";

    import { currentUrl } from "@/core/uiState.svelte";

    /** The navigation event is the source of truth after mount. Keeping this
     * label read-only avoids implying that arbitrary URL entry is supported. */
    const location = $derived(currentUrl.value || "No documentation selected");
</script>

<header
    class="toolbar">
    <div class="brand">
        <BookOpenText />
        <span class="brand-name">TurboDoc</span>
    </div>

    <div
        class="location"
        title={location}>
        <Globe2 />
        <span class="location-text">{location}</span>
    </div>

    <!-- Symmetric outer columns keep the location centered as the window grows. -->
    <div aria-hidden="true"></div>
</header>

<style>
    .toolbar {
        display: grid;
        height: 2.5rem;
        flex-shrink: 0;
        grid-template-columns: minmax(7rem, 1fr) minmax(16rem, 44rem) minmax(7rem, 1fr);
        align-items: center;
        gap: 0.75rem;
        border-bottom: 1px solid var(--color-workbench-divider);
        background-color: var(--color-workbench-chrome);
        padding-inline: 0.75rem;
    }

    .brand {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 0.5rem;
        font-size: 13px;
        font-weight: 600;
    }

    .brand :global(svg) {
        width: 1rem;
        height: 1rem;
        color: var(--color-primary);
    }

    .brand-name,
    .location-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .location {
        display: flex;
        min-width: 0;
        height: 1.75rem;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        border: 1px solid var(--color-workbench-divider);
        border-radius: var(--radius-md);
        background-color: var(--color-workbench);
        padding-inline: 0.75rem;
        color: var(--color-muted-foreground);
        font-size: 0.75rem;
        box-shadow: 0 1px 2px 0 rgb(0 0 0 / 5%);
    }

    .location :global(svg) {
        width: 0.875rem;
        height: 0.875rem;
        flex-shrink: 0;
    }
</style>
