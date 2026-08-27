import { describe, expect, test } from "bun:test";

import type { SourceModelContext } from "@/core/source";
import type { RustBookSourceData } from "@/adapters/rust-book";
import type { WebSourceData } from "@/adapters/web";
import { RustBookSource } from "@/sources/rust-books";
import { RustCrateSource } from "@/sources/rust-crates";
import {
    MinecraftWikiSource,
    WikipediaSource,
} from "@/sources/web-sources";

/** Create a mutable source context with navigation capture. */
function context<D extends object>(data: D, currentUrl: string): {
    context: SourceModelContext<D>;
    navigations: string[];
} {
    const navigations: string[] = [];
    return {
        context: {
            data,
            currentUrl,
            navigateTo: url => navigations.push(url),
        },
        navigations,
    };
}

describe("per-source persistence initialization", () => {
    test("seeds Rust crates only for a genuinely missing resource", () => {
        const missing = RustCrateSource.initializeData({}, false);
        const explicitEmpty = RustCrateSource.initializeData({
            schemaVersion: 1,
            crates: {},
        }, true);

        expect({
            missingCrates: Object.keys(missing.data.crates),
            missingPersist: missing.persist,
            explicitCrates: Object.keys(explicitEmpty.data.crates),
            explicitPersist: explicitEmpty.persist,
        }).toEqual({
            missingCrates: ["serde", "tokio"],
            missingPersist: true,
            explicitCrates: [],
            explicitPersist: false,
        });
    });

    test("rejects malformed existing data instead of replacing it", () => {
        expect(() => WikipediaSource.initializeData({
            schemaVersion: 1,
            pinnedPages: "not-an-array",
        }, true)).toThrow();
    });

    test("keeps each web source state flat and independent", () => {
        const minecraft = MinecraftWikiSource.initializeData({}, false);
        const wikipedia = WikipediaSource.initializeData({
            schemaVersion: 1,
            pinnedPages: ["https://en.wikipedia.org/wiki/Logic"],
        }, true);

        expect({ minecraft: minecraft.data, wikipedia: wikipedia.data }).toEqual({
            minecraft: { schemaVersion: 1, pinnedPages: [] },
            wikipedia: {
                schemaVersion: 1,
                pinnedPages: ["https://en.wikipedia.org/wiki/Logic"],
            },
        });
    });
});

describe("WebAdapter source models", () => {
    test("isolates exact source ownership and rejects unsafe lookalikes", () => {
        expect([
            MinecraftWikiSource.matchUrl("https://minecraft.wiki/w/Redstone"),
            MinecraftWikiSource.matchUrl("https://minecraft.wiki.example.com/w/Redstone"),
            MinecraftWikiSource.matchUrl("http://minecraft.wiki/w/Redstone"),
            WikipediaSource.matchUrl("https://en.wikipedia.org/wiki/Rust"),
        ]).toEqual([true, false, false, true]);
    });

    test("renders and pins a preview against flat source data", () => {
        const data: WebSourceData = { schemaVersion: 1, pinnedPages: [] };
        const { context: sourceContext } = context(
            data,
            "https://minecraft.wiki/w/Redstone#Power");

        const item = MinecraftWikiSource.render(sourceContext)
            .items["minecraft-wiki"];
        const preview = item?.pages.find(page => page.pinned === false);
        preview?.setPinned(true);

        expect({
            name: preview?.name,
            pinnedPages: data.pinnedPages,
            blocks: item?.pageLayout?.blocks.map(block => block.id),
        }).toEqual({
            name: { type: "text", text: "Redstone" },
            pinnedPages: ["https://minecraft.wiki/w/Redstone#Power"],
            blocks: ["home", "", "preview"],
        });
    });

    test("search selection opens only the compiled source home", () => {
        const data: WebSourceData = { schemaVersion: 1, pinnedPages: [] };
        const { context: sourceContext, navigations } = context(data, "");
        const view = WikipediaSource.render(sourceContext);

        view.search?.selectItem("minecraft-wiki");
        view.search?.selectItem("wikipedia");

        expect(navigations).toEqual(["https://en.wikipedia.org/wiki/Main_Page"]);
    });
});

describe("RustBookAdapter source models", () => {
    test("places a known preview in checked-in book sections", () => {
        const data: RustBookSourceData = { schemaVersion: 1, pinnedPages: [] };
        const { context: sourceContext } = context(
            data,
            `${RustBookSource.homeUrl}ch03-05-control-flow.html`);

        const item = RustBookSource.render(sourceContext).items["rust-book"];
        const chapter = item?.pageLayout?.blocks.find(block =>
            block.titlePath?.includes("Common Programming Concepts"));

        expect(chapter?.pageUrls).toEqual([
            `${RustBookSource.homeUrl}ch03-05-control-flow.html`,
        ]);
    });
});
