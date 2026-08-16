import { describe, expect, test } from "bun:test";

import type { DocProviderContext } from ".";
import DocProvider from ".";

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

describe("DocProvider", () => {
    test("renders every hard-coded site without persisted data", () => {
        const { ctx } = context("https://en.wikipedia.org/wiki/Main_Page");

        expect(Object.keys(DocProvider.render(ctx).items)).toEqual([
            "wikipedia",
            "rust-book",
            "minecraft-wiki",
        ]);
    });

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

    test("selecting a catalog item navigates to its fixed home", () => {
        const { ctx, navigations } = context("https://en.wikipedia.org/wiki/Main_Page");

        DocProvider.render(ctx).search?.selectItem("rust-book");

        expect(navigations).toEqual([
            "https://doc.rust-lang.org/stable/book/",
        ]);
    });
});
