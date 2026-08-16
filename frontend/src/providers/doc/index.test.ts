import { describe, expect, test } from "bun:test";
import BookOpenText from "@lucide/svelte/icons/book-open-text";

import {
    createDocProvider,
    type DocProviderConfig,
    type DocProviderContext,
} from ".";
import {
    MINECRAFT_WIKI_SITE,
    RUST_BOOK_SITE,
    WIKIPEDIA_SITE,
} from "./sites";

/** Multi-site fixture exercises the factory independently of registry layout. */
const DOC_PROVIDER_CONFIG = {
    id: "doc-test",
    name: "Test Docs",
    icon: { type: "lucide", icon: BookOpenText },
    homeSiteId: WIKIPEDIA_SITE.id,
    enableItemGrouping: true,
    search: {
        placeholder: "Search documentation sites",
        invalidText: "No configured site matches that name.",
    },
    sites: [WIKIPEDIA_SITE, RUST_BOOK_SITE, MINECRAFT_WIKI_SITE],
} satisfies DocProviderConfig;

const DocProvider = createDocProvider(DOC_PROVIDER_CONFIG);

/** Build a mutable test context with navigation capture. */
function context(currentUrl: string): {
    ctx: DocProviderContext;
    navigations: string[];
} {
    const navigations: string[] = [];
    return {
        ctx: {
            data: {},
            currentUrl,
            navigateTo: url => navigations.push(url),
        },
        navigations,
    };
}

describe("createDocProvider", () => {
    test("renders every configured site without persisted data", () => {
        const { ctx } = context("https://en.wikipedia.org/wiki/Main_Page");

        expect(Object.keys(DocProvider.render(ctx).items)).toEqual([
            "wikipedia",
            "rust-book",
            "minecraft-wiki",
        ]);
    });

    test("isolates URL ownership between provider instances", () => {
        const rustDocs = createDocProvider({
            ...DOC_PROVIDER_CONFIG,
            id: "rust-doc-test",
            homeSiteId: RUST_BOOK_SITE.id,
            sites: [RUST_BOOK_SITE],
        });
        const minecraftWiki = createDocProvider({
            ...DOC_PROVIDER_CONFIG,
            id: "minecraft-wiki-test",
            homeSiteId: MINECRAFT_WIKI_SITE.id,
            sites: [MINECRAFT_WIKI_SITE],
        });

        expect(rustDocs.ownsUrl(
            "https://doc.rust-lang.org/stable/book/ch01-00-getting-started.html",
        )).toBeTrue();
        expect(rustDocs.ownsUrl("https://minecraft.wiki/w/Redstone")).toBeFalse();
        expect(minecraftWiki.ownsUrl("https://minecraft.wiki/w/Redstone")).toBeTrue();
    });

    test("rejects unsafe and lookalike navigation targets", () => {
        expect(DocProvider.ownsUrl("http://minecraft.wiki/w/Redstone")).toBeFalse();
        expect(DocProvider.ownsUrl(
            "https://en.wikipedia.org.example.com/wiki/Rust",
        )).toBeFalse();
        expect(DocProvider.ownsUrl(
            "https://doc.rust-lang.org/stable/std/vec/struct.Vec.html",
        )).toBeFalse();
    });

    test("normalizes aliases before exposing the provider home", () => {
        const provider = createDocProvider({
            ...DOC_PROVIDER_CONFIG,
            id: "rust-alias-test",
            homeSiteId: "book-alias",
            sites: [{
                ...RUST_BOOK_SITE,
                id: "book-alias",
                homeUrl: "https://doc.rust-lang.org/book",
            }],
        });

        expect(provider.homeUrl).toBe("https://doc.rust-lang.org/stable/book/");
    });

    test("rejects invalid provider identifiers", () => {
        expect(() => createDocProvider({
            ...DOC_PROVIDER_CONFIG,
            id: "Rust Docs",
        })).toThrow("not a valid provider identifier");
    });

    test("rejects an empty site catalog", () => {
        expect(() => createDocProvider({
            ...DOC_PROVIDER_CONFIG,
            sites: [],
        })).toThrow("must configure at least one site");
    });

    test("rejects duplicate site identifiers", () => {
        expect(() => createDocProvider({
            ...DOC_PROVIDER_CONFIG,
            sites: [WIKIPEDIA_SITE, WIKIPEDIA_SITE],
        })).toThrow("duplicate site ID");
    });

    test("rejects an unknown home site", () => {
        expect(() => createDocProvider({
            ...DOC_PROVIDER_CONFIG,
            homeSiteId: "missing",
        })).toThrow("unknown home site");
    });

    test("rejects a site that does not own its home URL", () => {
        expect(() => createDocProvider({
            ...DOC_PROVIDER_CONFIG,
            sites: [{
                ...WIKIPEDIA_SITE,
                homeUrl: "https://example.com/",
            }],
        })).toThrow("does not own its home URL");
    });
});

describe("factory-created Doc provider rendering", () => {
    test("renders an unpinned current page as the preview tail", () => {
        const currentUrl = "https://minecraft.wiki/w/Redstone#Power_sources";
        const { ctx } = context(currentUrl);

        const pages = DocProvider.render(ctx).items["minecraft-wiki"]?.pages;

        expect(pages?.map(page => ({
            name: page.name.type === "text" ? page.name.text : "symbol",
            current: page.current,
            pinned: page.pinned,
        }))).toEqual([
            { name: "Home", current: false, pinned: null },
            { name: "Redstone", current: true, pinned: false },
        ]);
    });

    test("pinning the preview appends its section target", () => {
        const currentUrl = "https://minecraft.wiki/w/Redstone#Power_sources";
        const { ctx } = context(currentUrl);
        const preview = DocProvider.render(ctx)
            .items["minecraft-wiki"]?.pages.at(-1);

        preview?.setPinned(true);

        expect(ctx.data.sites?.["minecraft-wiki"]?.pinnedPages).toEqual([
            currentUrl,
        ]);
    });

    test("treats another fragment as the same pinned page", () => {
        const pinned = "https://minecraft.wiki/w/Redstone#Power_sources";
        const { ctx } = context(
            "https://minecraft.wiki/w/Redstone#Signal_strength");
        ctx.data.sites = {
            "minecraft-wiki": { pinnedPages: [pinned] },
        };

        const pages = DocProvider.render(ctx).items["minecraft-wiki"]?.pages;

        expect(pages).toHaveLength(2);
        expect(pages?.[1]?.url).toBe(pinned);
        expect(pages?.[1]?.current).toBeTrue();
    });

    test("reordering pages persists the requested permutation", () => {
        const { ctx } = context("https://minecraft.wiki/");
        const redstone = "https://minecraft.wiki/w/Redstone";
        const creeper = "https://minecraft.wiki/w/Creeper";
        ctx.data.sites = {
            "minecraft-wiki": { pinnedPages: [redstone, creeper] },
        };
        const item = DocProvider.render(ctx).items["minecraft-wiki"];

        item?.reorderPages?.([creeper, redstone]);

        expect(ctx.data.sites["minecraft-wiki"]?.pinnedPages).toEqual([
            creeper,
            redstone,
        ]);
    });

    test("selecting a catalog item navigates to its canonical home", () => {
        const { ctx, navigations } = context(
            "https://en.wikipedia.org/wiki/Main_Page");

        DocProvider.render(ctx).search?.selectItem("rust-book");

        expect(navigations).toEqual([
            "https://doc.rust-lang.org/stable/book/",
        ]);
    });
});
