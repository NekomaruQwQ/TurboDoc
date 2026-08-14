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
    class="provider-nav">
    {#each providers as provider (provider.id)}
        {@const active = provider.id === activeProviderId}
        <button
            type="button"
            aria-label={provider.name}
            aria-current={active ? "page" : undefined}
            title={provider.name}
            class="provider-destination"
            onclick={() => onProviderSelect(provider)}>
            {#if active}
                <span
                    aria-hidden="true"
                    class="active-marker">
                </span>
            {/if}
            <Icon icon={provider.icon} size="xl" />
        </button>
    {/each}
</nav>

<style>
    .provider-nav {
        display: flex;
        width: 2.75rem;
        flex-shrink: 0;
        flex-direction: column;
        overflow-y: auto;
        border-right: 1px solid var(--color-workbench-divider);
        background-color: var(--color-workbench);
    }

    .provider-destination {
        position: relative;
        display: flex;
        width: 100%;
        height: 2.75rem;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        border: 0;
        background-color: transparent;
        color: var(--color-muted-foreground);
        outline: none;
        transition: color 150ms, background-color 150ms;
    }

    .provider-destination[aria-current="page"] {
        color: var(--color-foreground);
    }

    .provider-destination:not([aria-current="page"]):hover {
        background-color: var(--color-workbench-hover);
        color: var(--color-foreground);
    }

    .provider-destination:focus-visible {
        box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--color-ring) 70%, transparent);
    }

    .active-marker {
        position: absolute;
        inset-block: 0.5rem;
        left: 0;
        width: 0.125rem;
        border-radius: 0 9999px 9999px 0;
        background-color: var(--color-primary);
    }
</style>
