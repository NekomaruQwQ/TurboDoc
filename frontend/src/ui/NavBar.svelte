<script lang="ts">
    import type { Topic } from "@/core/topic";

    import Icon from "@/ui/common/Icon.svelte";

    let {
        topics,
        activeTopicId,
        onTopicSelect,
    }: {
        /** Topics are rendered in registry order from top to bottom. */
        topics: readonly Topic[],
        /** Topic whose Explorer is currently visible. */
        activeTopicId: string,
        /** Report explicit selection intent to the workbench state owner. */
        onTopicSelect(topic: Topic): void,
    } = $props();
</script>

<nav
    aria-label="Primary navigation"
    class="topic-nav">
    {#each topics as topic (topic.id)}
        {@const active = topic.id === activeTopicId}
        <button
            type="button"
            aria-label={topic.name}
            aria-current={active ? "page" : undefined}
            title={topic.name}
            class="topic-destination"
            onclick={() => onTopicSelect(topic)}>
            {#if active}
                <span
                    aria-hidden="true"
                    class="active-marker">
                </span>
            {/if}
            <Icon icon={topic.icon} size="xl" />
        </button>
    {/each}
</nav>

<style>
    .topic-nav {
        display: flex;
        width: 2.75rem;
        flex-shrink: 0;
        flex-direction: column;
        overflow-y: auto;
        border-right: 1px solid var(--color-workbench-divider);
        background-color: var(--color-workbench);
    }

    .topic-destination {
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

    .topic-destination[aria-current="page"] {
        color: var(--color-foreground);
    }

    .topic-destination:not([aria-current="page"]):hover {
        background-color: var(--color-workbench-hover);
        color: var(--color-foreground);
    }

    .topic-destination:focus-visible {
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
