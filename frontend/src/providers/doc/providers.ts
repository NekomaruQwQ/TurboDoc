import Blocks from "@lucide/svelte/icons/blocks";
import BookOpenText from "@lucide/svelte/icons/book-open-text";
import LibraryBig from "@lucide/svelte/icons/library-big";

import { createDocProvider } from ".";
import { RUST_BOOK_SITES } from "./books";
import {
    MINECRAFT_WIKI_SITE,
    RUST_BOOK_SITE,
    WIKIPEDIA_SITE,
} from "./sites";

/** Rust prose documentation, separate from the symbol-oriented Rust provider. */
export const RustDocProvider = createDocProvider({
    id: "rust-doc",
    name: "Rust Docs",
    icon: { type: "lucide", icon: BookOpenText },
    homeSiteId: RUST_BOOK_SITE.id,
    enableItemGrouping: false,
    search: {
        placeholder: "Search Rust documentation sites",
        invalidText: "No Rust documentation site matches that name.",
    },
    sites: RUST_BOOK_SITES,
});

/** Minecraft Wiki as an independent provider and persistence namespace. */
export const MinecraftWikiProvider = createDocProvider({
    id: "minecraft-wiki",
    name: "Minecraft Wiki",
    icon: { type: "lucide", icon: Blocks },
    homeSiteId: MINECRAFT_WIKI_SITE.id,
    enableItemGrouping: false,
    search: {
        placeholder: "Search Minecraft Wiki",
        invalidText: "No Minecraft Wiki site matches that name.",
    },
    sites: [MINECRAFT_WIKI_SITE],
});

/** English Wikipedia as an independent provider and persistence namespace. */
export const WikipediaProvider = createDocProvider({
    id: "wikipedia",
    name: "Wikipedia",
    icon: { type: "lucide", icon: LibraryBig },
    homeSiteId: WIKIPEDIA_SITE.id,
    enableItemGrouping: false,
    search: {
        placeholder: "Search Wikipedia",
        invalidText: "No Wikipedia site matches that name.",
    },
    sites: [WIKIPEDIA_SITE],
});
