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
{:else}
    <span
        aria-hidden="true"
        class={["mask-icon", className]}
        data-size={size}
        style:--mask-source={`url("${icon.src}")`}>
    </span>
{/if}

<style>
    .mask-icon {
        display: inline-block;
        width: var(--icon-size);
        height: var(--icon-size);
        flex-shrink: 0;
        background-color: currentcolor;
        mask: var(--mask-source) center / contain no-repeat;
        -webkit-mask: var(--mask-source) center / contain no-repeat;
    }

    .mask-icon[data-size="xs"] { --icon-size: 12px; }
    .mask-icon[data-size="sm"] { --icon-size: 14px; }
    .mask-icon[data-size="default"] { --icon-size: 16px; }
    .mask-icon[data-size="lg"] { --icon-size: 20px; }
    .mask-icon[data-size="xl"] { --icon-size: 24px; }
</style>
