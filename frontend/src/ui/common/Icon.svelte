<script lang="ts">
    import type { IconProp } from "@/core/data";

    type IconSize = "xs" | "sm" | "default" | "lg" | "xl";

    const SIZE_PX: Record<IconSize, number> = {
        xs: 12,
        sm: 14,
        default: 16,
        lg: 20,
        xl: 24,
    };

    let { icon, size = "default", class: className = "" }: {
        icon: IconProp,
        size?: IconSize,
        class?: string,
    } = $props();
</script>

{#if icon.type === "lucide"}
    {@const Component = icon.icon}
    <Component size={SIZE_PX[size]} class={className} />
{/if}
