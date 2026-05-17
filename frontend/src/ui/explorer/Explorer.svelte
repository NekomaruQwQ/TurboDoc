<script lang="ts">
    import type { AppData } from "@/core/data";
    import providers from "@/providers";

    import ExplorerProvider from "@/ui/explorer/ExplorerProvider.svelte";

    let { appData }: { appData: AppData } = $props();

    const activeProviders = $derived(
        appData.presets[appData.currentPreset]?.providers
            .map(id => providers[id])
            .filter(p => p !== undefined) ?? []);
</script>

{#each activeProviders as provider (provider.id)}
    <ExplorerProvider {provider} />
{/each}
