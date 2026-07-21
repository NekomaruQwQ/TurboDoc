<script lang="ts">
    import type { Provider } from "@/core/data";

    let { provider }: { provider: Provider } = $props();
</script>

<header
    class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-workbench-divider px-3">
    <h1 class="text-[11px] font-semibold uppercase tracking-[0.08em]">Explorer</h1>
    <!-- The provider name gives context without introducing an inert switcher. -->
    <span class="truncate text-[11px] text-muted-foreground" title={provider.name}>
        {provider.name}
    </span>
</header>
