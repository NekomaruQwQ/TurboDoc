import { describe, expect, test } from "bun:test";

import type { SourceModelContext } from "@/core/source";
import type { RustBookSourceData } from "@/adapters/rust-book";
import type { RustCrateSourceData } from "@/adapters/rust-crate";
import type { WebSourceData } from "@/adapters/web";
import { RustBookSource } from "@/sources/rust-books";
import { RustCrateSource } from "@/sources/rust-crates";
import {
    MinecraftWikiSource,
    MinecraftWikiChineseSource,
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
        const chinese = MinecraftWikiChineseSource.initializeData({
            schemaVersion: 1,
            pinnedPages: ["https://zh.minecraft.wiki/w/Redstone?variant=zh-cn"],
            collections: { Mechanics: { pages: ["https://zh.minecraft.wiki/w/Redstone?variant=zh-cn"] } },
        }, true);
        const wikipedia = WikipediaSource.initializeData({
            schemaVersion: 1,
            pinnedPages: ["https://en.wikipedia.org/wiki/Logic"],
        }, true);

        expect({ minecraft: minecraft.data, chinese: chinese.data, wikipedia: wikipedia.data }).toEqual({
            minecraft: { schemaVersion: 1, pinnedPages: [] },
            chinese: {
                schemaVersion: 1,
                pinnedPages: ["https://zh.minecraft.wiki/w/Redstone?variant=zh-cn"],
                collections: { Mechanics: { pages: ["https://zh.minecraft.wiki/w/Redstone?variant=zh-cn"] } },
            },
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

    test("bulk imports pages in input order without replacing pins or collections", async () => {
        const redstone = "https://minecraft.wiki/w/Redstone#Power";
        const stone = "https://minecraft.wiki/w/Stone";
        const brewing = "https://minecraft.wiki/w/Brewing?oldid=123";
        const creeper = "https://minecraft.wiki/w/Creeper#Drops";
        const data: WebSourceData = {
            schemaVersion: 1,
            pinnedPages: [redstone, stone],
            collections: { Wiring: { pages: [redstone] }, Empty: { pages: [] } },
        };
        const { context: sourceContext, navigations } = context(data, "");
        const view = MinecraftWikiSource.render(sourceContext);

        await view.search?.emptyAction?.invoke([
            "", ` ${brewing}#Ingredients `,
            `${brewing}#Equipment`, "https://minecraft.wiki/w/Redstone#Circuits",
            creeper, creeper, "",
        ].join("\r\n"));

        expect({ data, navigations }).toEqual({
            data: {
                schemaVersion: 1,
                pinnedPages: [redstone, stone, `${brewing}#Ingredients`, creeper],
                collections: { Wiring: { pages: [redstone] }, Empty: { pages: [] } },
            },
            navigations: [],
        });
        expect(MinecraftWikiSource.render(sourceContext).items["minecraft-wiki"]
            ?.pageLayout?.blocks.find(block => block.id === "")?.pageUrls)
            .toEqual([stone, `${brewing}#Ingredients`, creeper]);
    });

    test("bulk import skips invalid, foreign, unsafe, and fixed-home URLs", async () => {
        const data: WebSourceData = { schemaVersion: 1, pinnedPages: [] };
        const { context: sourceContext } = context(data, "");
        const view = MinecraftWikiSource.render(sourceContext);

        await view.search?.emptyAction?.invoke([
            "not a URL", "/w/Redstone", "javascript:alert(1)",
            "https://en.wikipedia.org/wiki/Redstone", "https://minecraft.wiki/#Home",
            "https://zh.minecraft.wiki/w/Redstone?variant=zh-cn",
            "http://zh.minecraft.wiki/w/Redstone",
            "https://zh.minecraft.wiki:8443/w/Redstone",
            "https://user:password@zh.minecraft.wiki/w/Redstone",
            "https://zh.minecraft.wiki.example.com/w/Redstone",
            "https://other.zh.minecraft.wiki/w/Redstone",
            "https://minecraft.wiki/w/Stone", "",
        ].join("\n"));

        expect(data.pinnedPages).toEqual(["https://minecraft.wiki/w/Stone"]);
    });

    test("bulk import leaves persistence untouched when no new page is accepted", async () => {
        const redstone = "https://minecraft.wiki/w/Redstone#Power";
        const data: WebSourceData = { schemaVersion: 1, pinnedPages: [redstone] };
        const { context: sourceContext } = context(data, "");
        const view = MinecraftWikiSource.render(sourceContext);

        await view.search?.emptyAction?.invoke(" \r\n\t\n");
        await view.search?.emptyAction?.invoke([
            "invalid", "https://en.wikipedia.org/wiki/Logic",
            "https://minecraft.wiki/", "https://minecraft.wiki/w/Redstone#Circuits",
        ].join("\n"));

        expect(data).toEqual({ schemaVersion: 1, pinnedPages: [redstone] });
    });

    test("an open import dialog merges with the latest pins and collections", async () => {
        const removed = "https://minecraft.wiki/w/Redstone";
        const stone = "https://minecraft.wiki/w/Stone";
        const creeper = "https://minecraft.wiki/w/Creeper";
        const data: WebSourceData = { schemaVersion: 1, pinnedPages: [removed] };
        const { context: sourceContext } = context(data, "");
        const action = MinecraftWikiSource.render(sourceContext).search?.emptyAction;

        // Another interaction replaces pins and creates a collection before submission.
        data.pinnedPages = [stone];
        data.collections = { Building: { pages: [stone] } };
        await action?.invoke([stone, creeper].join("\n"));

        expect(data).toEqual({
            schemaVersion: 1,
            pinnedPages: [stone, creeper],
            collections: { Building: { pages: [stone] } },
        });
    });

    test("preserves Chinese variants and section targets while matching pinned pages", async () => {
        const brewing = "https://zh.minecraft.wiki/w/%E8%8D%AF%E6%B0%B4%E9%85%BF%E9%80%A0";
        const simplified = `${brewing}?variant=zh-cn#Ingredients`;
        const traditional = `${brewing}?variant=zh-tw#Equipment`;
        const data: WebSourceData = { schemaVersion: 1, pinnedPages: [] };
        const { context: sourceContext } = context(data, `${brewing}?variant=zh-cn#Other`);

        await MinecraftWikiChineseSource.render(sourceContext).search?.emptyAction?.invoke([
            "https://zh.minecraft.wiki/", "https://minecraft.wiki/w/Brewing",
            "https://zh.minecraft.wiki/w/药水酿造?variant=zh-cn#Ingredients",
            `${brewing}?variant=zh-cn#Other`, traditional,
            `${brewing}?variant=zh-cn&oldid=123#History`,
            `${brewing}?oldid=123&variant=zh-cn#Duplicate`,
        ].join("\n"));
        const item = MinecraftWikiChineseSource.render(sourceContext).items["minecraft-wiki-zh"];

        expect({
            pins: data.pinnedPages,
            pages: item?.pages.filter(page => page.pinned !== null).map(page => ({
                name: page.name, url: page.url, current: page.current, pinned: page.pinned,
            })),
        }).toEqual({
            pins: [simplified, traditional, `${brewing}?oldid=123&variant=zh-cn#History`],
            pages: [
                { name: { type: "text", text: "药水酿造" }, url: simplified, current: true, pinned: true },
                { name: { type: "text", text: "药水酿造" }, url: traditional, current: false, pinned: true },
                {
                    name: { type: "text", text: "药水酿造" },
                    url: `${brewing}?oldid=123&variant=zh-cn#History`, current: false, pinned: true,
                },
            ],
        });
    });

    test("Wikipedia uses the same importer with its own ownership rules", async () => {
        const logic = "https://en.wikipedia.org/wiki/Logic#History";
        const data: WebSourceData = { schemaVersion: 1, pinnedPages: [] };
        const { context: sourceContext } = context(data, "");

        await WikipediaSource.render(sourceContext).search?.emptyAction?.invoke([
            "https://minecraft.wiki/w/Redstone", "https://en.wikipedia.org/wiki/Main_Page",
            logic, "https://en.wikipedia.org/wiki/Logic#Other",
        ].join("\n"));

        expect(data.pinnedPages).toEqual([logic]);
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

describe("RustCrateAdapter module blocks", () => {
    test("pinning and unpinning Windows previews preserve full metadata with leaf display", () => {
        const base = "https://microsoft.github.io/windows-docs-rs/doc/";
        const modulePath = "windows/Win32/Graphics/Dxgi";
        const previewPath = `${modulePath}/struct.IDXGIFactory.html`;
        const data: RustCrateSourceData = {
            schemaVersion: 1,
            crates: { windows: { currentVersion: "latest", pinnedPages: [] } },
        };
        const { context: sourceContext } = context(data, `${base}${previewPath}`);
        const before = RustCrateSource.render(sourceContext).items.windows;
        const preview = before?.pages.find(page => page.pinned === false);
        preview?.setPinned(true);
        const pinned = RustCrateSource.render(sourceContext).items.windows;

        expect({
            blocks: pinned?.pageLayout,
            name: pinned?.pages.find(page => page.current)?.name,
            sortKey: pinned?.pages.find(page => page.current)?.sortKey,
            data,
        }).toEqual({
            blocks: before?.pageLayout,
            name: {
                type: "symbol",
                separator: "::",
                display: "leaf",
                path: [
                    { type: "namespace", name: "windows" },
                    { type: "namespace", name: "Win32" },
                    { type: "namespace", name: "Graphics" },
                    { type: "namespace", name: "Dxgi" },
                    { type: "type", name: "IDXGIFactory" },
                ],
            },
            sortKey: "windows::Win32::Graphics::Dxgi::IDXGIFactory",
            data: {
                schemaVersion: 1,
                crates: { windows: { currentVersion: "latest", pinnedPages: [previewPath] } },
            },
        });

        pinned?.pages.find(page => page.current)?.setPinned(false);
        const unpinned = RustCrateSource.render(sourceContext).items.windows;
        expect({
            layout: unpinned?.pageLayout,
            currentPin: unpinned?.pages.find(page => page.current)?.pinned,
            pins: data.crates.windows?.pinnedPages,
        }).toEqual({
            layout: { blocks: [
                { id: "home", pageUrls: [`${base}windows/`] },
                {
                    id: `module:${modulePath}`,
                    titlePath: ["Win32", "Graphics", "Dxgi"],
                    pageUrls: [`${base}${previewPath}`],
                },
            ] },
            currentPin: false,
            pins: [],
        });
    });

    test("drops an empty preview block after navigation without persisting layout", () => {
        const data: RustCrateSourceData = {
            schemaVersion: 1,
            crates: { windows: { currentVersion: "latest", pinnedPages: [] } },
        };
        const modulePath = "windows/Win32/Graphics/Dxgi";
        const { context: sourceContext } = context(data,
            `https://microsoft.github.io/windows-docs-rs/doc/${modulePath}/index.html`);
        const before = RustCrateSource.render(sourceContext).items.windows;
        const item = RustCrateSource.render({ ...sourceContext, currentUrl: "https://docs.rs/" }).items.windows;

        expect({
            before: before?.pageLayout?.blocks.map(block => block.id),
            layout: item?.pageLayout,
            data,
        }).toEqual({
            before: ["home", `module:${modulePath}`],
            layout: { blocks: [{
                id: "home",
                pageUrls: ["https://microsoft.github.io/windows-docs-rs/doc/windows/"],
            }] },
            data: {
                schemaVersion: 1,
                crates: { windows: { currentVersion: "latest", pinnedPages: [] } },
            },
        });
    });

    test.each(["", "/", "/index.html"])("uses a dot for module suffix %j without changing the home name", suffix => {
        const modulePath = "windows/Win32/Graphics/Dxgi";
        const data: RustCrateSourceData = {
            schemaVersion: 1,
            crates: { windows: {
                currentVersion: "latest",
                pinnedPages: [`${modulePath}${suffix}`],
            } },
        };
        const { context: sourceContext } = context(data, "");
        const item = RustCrateSource.render(sourceContext).items.windows;

        expect(item?.pages.map(page => page.name)).toEqual([
            {
                type: "symbol",
                separator: "::",
                display: { type: "namespace", name: "." },
                path: [
                    { type: "namespace", name: "windows" },
                    { type: "namespace", name: "Win32" },
                    { type: "namespace", name: "Graphics" },
                    { type: "namespace", name: "Dxgi" },
                ],
            },
            { type: "text", text: "windows" },
        ]);
        expect(item?.pages[0]?.sortKey).toBe("windows::Win32::Graphics::Dxgi");
        expect(item?.pageLayout?.blocks[1]).toEqual({
            id: `module:${modulePath}`,
            titlePath: ["Win32", "Graphics", "Dxgi"],
            pageUrls: [`https://microsoft.github.io/windows-docs-rs/doc/${modulePath}${suffix || "/"}`],
        });
    });

    test.each(["/", "/index.html"])("keeps the module dot stable through pinning for %j", suffix => {
        const path = `windows/Win32/Graphics/Dxgi${suffix}`;
        const url = `https://microsoft.github.io/windows-docs-rs/doc/${path}`;
        const data: RustCrateSourceData = {
            schemaVersion: 1,
            crates: { windows: { currentVersion: "latest", pinnedPages: [] } },
        };
        const { context: sourceContext } = context(data, url);
        const before = RustCrateSource.render(sourceContext).items.windows;
        const preview = before?.pages.find(page => page.pinned === false);
        expect(preview?.name).toMatchObject({ display: { type: "namespace", name: "." } });
        preview?.setPinned(true);
        const pinned = RustCrateSource.render(sourceContext).items.windows;
        const current = pinned?.pages.find(page => page.current);

        expect({ name: current?.name, url: current?.url, layout: pinned?.pageLayout }).toEqual({
            name: preview?.name, url, layout: before?.pageLayout,
        });
        expect(data.crates.windows?.pinnedPages).toEqual([path]);
        current?.setPinned(false);
        const unpinned = RustCrateSource.render(sourceContext).items.windows;
        expect(unpinned?.pages.find(page => page.pinned === false)?.name).toEqual(preview?.name);
        expect(data.crates.windows?.pinnedPages).toEqual([]);
    });

    test.each([
        "windows", "windows/", "windows/index.html",
        "windows/Win32//Graphics/", "windows/not-a-module/", "other/Win32/",
    ])("keeps the name of root or unclassified path %j", path => {
        const data: RustCrateSourceData = {
            schemaVersion: 1,
            crates: { windows: { currentVersion: "latest", pinnedPages: [path] } },
        };
        const { context: sourceContext } = context(data, "");
        const item = RustCrateSource.render(sourceContext).items.windows;
        expect(item?.pages[0]?.name).toMatchObject({ type: "symbol", display: "leaf" });
    });

    test("leaves standard-library, third-party and windows-sys crates flat", () => {
        const data: RustCrateSourceData = {
            schemaVersion: 1,
            crates: {
                std: { currentVersion: "stable", pinnedPages: ["std/vec/struct.Vec.html", "std/vec/"] },
                serde: { currentVersion: "latest", pinnedPages: ["serde/trait.Serialize.html", "serde/de/index.html"] },
                "windows-sys": {
                    currentVersion: "latest",
                    pinnedPages: ["windows_sys/Win32/Graphics/Dxgi/index.html"],
                },
            },
        };
        const { context: sourceContext } = context(data, "");
        const items = Object.values(RustCrateSource.render(sourceContext).items);

        expect(items.map(item => [item.id, item.pageLayout, item.pages.length])).toEqual([
            ["std", undefined, 3], ["serde", undefined, 3], ["windows-sys", undefined, 2],
        ]);
        expect(items.every(item => item.pages.every(page =>
            page.name.type !== "symbol" || page.name.display === undefined))).toBe(true);
    });
});
