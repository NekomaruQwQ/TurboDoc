import Blocks from "@lucide/svelte/icons/blocks";
import BookOpenText from "@lucide/svelte/icons/book-open-text";
import LibraryBig from "@lucide/svelte/icons/library-big";

import type { Topic } from "@/core/topic";
import { getTopicHomeUrl } from "@/core/topic";
import { RustBookSource, RustBookSources } from "@/sources/rust-books";
import { RustCrateSource } from "@/sources/rust-crates";
import {
    MinecraftWikiSource,
    MinecraftWikiChineseSource,
    WikipediaSource,
} from "@/sources/web-sources";

/** UI-only topics rendered in workbench navigation order. */
const topics: readonly Topic[] = [
    {
        id: "rust-crates",
        name: "Rust Crates",
        icon: {
            type: "monochrome-svg",
            src: new URL("./rust.svg", import.meta.url).href,
        },
        homeSourceId: RustCrateSource.id,
        sources: [RustCrateSource],
        search: {
            placeholder: "Search crates",
            invalidText: "Crate names use letters, numbers, hyphens, or underscores.",
        },
    },
    {
        id: "rust-books",
        name: "Rust Books",
        icon: { type: "lucide", icon: BookOpenText },
        homeSourceId: RustBookSource.id,
        sources: RustBookSources,
        search: {
            placeholder: "Search Rust books",
            invalidText: "No configured Rust book matches that name.",
        },
    },
    {
        id: "minecraft-wiki",
        name: "Minecraft Wiki",
        icon: { type: "lucide", icon: Blocks },
        homeSourceId: MinecraftWikiSource.id,
        sources: [MinecraftWikiSource, MinecraftWikiChineseSource],
        search: {
            placeholder: "Search Minecraft Wiki",
            invalidText: "No Minecraft Wiki item matches that name.",
        },
    },
    {
        id: "wikipedia",
        name: "Wikipedia",
        icon: { type: "lucide", icon: LibraryBig },
        homeSourceId: WikipediaSource.id,
        sources: [WikipediaSource],
        search: {
            placeholder: "Search Wikipedia",
            invalidText: "No Wikipedia item matches that name.",
        },
    },
];

/** Validate registry invariants once at module initialization. */
function validateTopics(registry: readonly Topic[]): void {
    const topicIds = new Set<string>();
    const sourceIds = new Set<string>();
    for (const topic of registry) {
        if (!topic.id || topicIds.has(topic.id))
            throw new Error(`Duplicate or empty topic ID "${topic.id}".`);
        topicIds.add(topic.id);
        if (topic.sources.length === 0)
            throw new Error(`Topic "${topic.id}" must contain at least one source.`);
        getTopicHomeUrl(topic);
        for (const source of topic.sources) {
            if (sourceIds.has(source.id)) {
                throw new Error(
                    `Source "${source.id}" belongs to more than one topic.`);
            }
            sourceIds.add(source.id);
        }
    }
}

validateTopics(topics);

export default topics;
