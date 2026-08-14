<script lang="ts">
    import type { Provider } from "@/core/data";

    import Icon from "@/ui/common/Icon.svelte";

    let {
        providers,
        activeProviderId,
        onProviderSelect,
    }: {
        /** Providers are rendered in registry order from top to bottom. */
        providers: readonly Provider[],
        /** Provider whose Explorer is currently visible. */
        activeProviderId: string,
        /** Report explicit selection intent to the workbench state owner. */
        onProviderSelect(provider: Provider): void,
    } = $props();
</script>

<nav
    aria-label="Primary navigation"
    class="flex w-11 shrink-0 flex-col overflow-y-auto border-r border-workbench-divider bg-workbench">
    {#each providers as provider (provider.id)}
        {@const active = provider.id === activeProviderId}
        <button
            type="button"
            aria-label={provider.name}
            aria-current={active ? "page" : undefined}
            title={provider.name}
            class={[
                "relative flex h-11 w-full shrink-0 items-center justify-center outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
                active
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-workbench-hover hover:text-foreground",
            ]}
            onclick={() => onProviderSelect(provider)}>
            {#if active}
                <span
                    aria-hidden="true"
                    class="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-primary">
                </span>
            {/if}
            <Icon icon={provider.icon} size="xl" />
        </button>
    {/each}
</nav>
