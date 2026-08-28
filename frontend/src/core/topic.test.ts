import { describe, expect, test } from "bun:test";
import Plus from "@lucide/svelte/icons/plus";

import { createItemKey } from "./itemKey";
import type { SourceModel } from "./source";
import {
    composeTopicView,
    findTopicForUrl,
    getTopicHomeUrl,
    type Topic,
} from "./topic";
import topics from "@/topics";
import { MinecraftWikiSource, MinecraftWikiChineseSource } from "@/sources/web-sources";

/** Build a minimal source model around one exact origin. */
function source(id: string, origin: string): SourceModel {
    return {
        id,
        name: id,
        homeUrl: origin,
        presentation: {
            renderItemNameAsCode: false,
            renderPageNameAsCode: false,
        },
        initializeData: () => ({ data: {}, persist: false }),
        matchUrl: input => {
            try {
                return new URL(input).origin === new URL(origin).origin;
            } catch {
                return false;
            }
        },
        render: () => ({ items: {} }),
    };
}

/** Build the narrow topic surface used by composition tests. */
function topic(sources: readonly SourceModel[]): Topic {
    const home = sources[0];
    if (!home) throw new Error("Test topic requires a source.");
    return {
        id: "test-topic",
        name: "Test Topic",
        icon: { type: "monochrome-svg", src: "test.svg" },
        homeSourceId: home.id,
        sources,
        search: { placeholder: "Search", invalidText: "No match" },
    };
}

describe("topic routing", () => {
    test("routes configured domains to disjoint UI topics", () => {
        expect(findTopicForUrl(topics, "https://docs.rs/")?.topic.id)
            .toBe("rust-crates");
        expect([
            findTopicForUrl(
                topics,
                "https://doc.rust-lang.org/stable/book/ch04-01-what-is-ownership.html")
                ?.topic.id,
            findTopicForUrl(
                topics,
                "https://doc.rust-lang.org/stable/std/vec/struct.Vec.html")
                ?.topic.id,
            findTopicForUrl(topics, "https://minecraft.wiki/w/Redstone")?.topic.id,
            findTopicForUrl(
                topics,
                "https://en.wikipedia.org/wiki/Rust_(programming_language)")
                ?.topic.id,
        ]).toEqual(["rust-books", "rust-crates", "minecraft-wiki", "wikipedia"]);
    });

    test("uses topic and source registration order as the overlap tie-breaker", () => {
        const first = source("first", "https://example.com/");
        const second = source("second", "https://example.com/");
        const firstTopic = topic([first]);
        const secondTopic = { ...topic([second]), id: "second-topic" };

        expect(findTopicForUrl(
            [firstTopic, secondTopic],
            "https://example.com/reference")?.source).toBe(first);
    });

    test("routes Chinese Minecraft Wiki navigation to its own source in the existing topic", () => {
        const match = findTopicForUrl(topics,
            "https://zh.minecraft.wiki/w/%E8%8D%AF%E6%B0%B4%E9%85%BF%E9%80%A0?variant=zh-cn");

        expect({
            topicId: match?.topic.id,
            sourceId: match?.source.id,
            home: match && getTopicHomeUrl(match.topic),
        }).toEqual({
            topicId: "minecraft-wiki",
            sourceId: "minecraft-wiki-zh",
            home: "https://minecraft.wiki/",
        });
    });

    test("every configured source belongs to exactly one topic", () => {
        const sourceIds = topics.flatMap(candidate =>
            candidate.sources.map(model => model.id));

        expect(new Set(sourceIds).size).toBe(sourceIds.length);
    });

    test("resolves the explicit home source instead of assuming first", () => {
        const first = source("first", "https://first.example/");
        const second = source("second", "https://second.example/");
        const configured = { ...topic([first, second]), homeSourceId: second.id };

        expect(getTopicHomeUrl(configured)).toBe(second.homeUrl);
    });
});

describe("topic view composition", () => {
    test("composes language-specific items and homes within the Minecraft Wiki topic", () => {
        const url = "https://zh.minecraft.wiki/w/药水酿造?variant=zh-cn";
        const configured = findTopicForUrl(topics, url)?.topic;
        if (!configured) throw new Error("Minecraft Wiki topic must own the Chinese page.");
        const navigations: string[] = [];
        const ready = [MinecraftWikiSource, MinecraftWikiChineseSource].map(model => ({
            model,
            view: model.render({
                data: model.initializeData({}, false).data,
                currentUrl: url,
                navigateTo: target => navigations.push(target),
            }),
        }));
        const view = composeTopicView(configured, ready);

        view.search?.selectItem(createItemKey("minecraft-wiki", "minecraft-wiki"));
        view.search?.selectItem(createItemKey("minecraft-wiki-zh", "minecraft-wiki-zh"));

        expect({
            active: view.search?.activeItemId,
            items: Object.values(view.items).map(item => ({
                name: item.name,
                home: item.pages.find(page => page.pinned === null)?.url,
                preview: item.pages.find(page => page.pinned === false)?.name,
            })),
            navigations,
        }).toEqual({
            active: createItemKey("minecraft-wiki-zh", "minecraft-wiki-zh"),
            items: [
                { name: "Minecraft Wiki (English)", home: "https://minecraft.wiki/", preview: undefined },
                {
                    name: "Minecraft Wiki (中文)", home: "https://zh.minecraft.wiki/",
                    preview: { type: "text", text: "药水酿造" },
                },
            ],
            navigations: ["https://minecraft.wiki/", "https://zh.minecraft.wiki/"],
        });
    });

    test("distinguishes language imports and keeps pins and collections in their owning source", async () => {
        const englishUrl = "https://minecraft.wiki/w/Brewing";
        const chineseUrl = "https://zh.minecraft.wiki/w/%E8%8D%AF%E6%B0%B4%E9%85%BF%E9%80%A0?variant=zh-cn";
        const configured = findTopicForUrl(topics, englishUrl)?.topic;
        if (!configured) throw new Error("Minecraft Wiki topic must own the English page.");
        const englishData = MinecraftWikiSource.initializeData({}, false).data;
        const chineseData = MinecraftWikiChineseSource.initializeData({}, false).data;
        const englishView = MinecraftWikiSource.render({
            data: englishData, currentUrl: "", navigateTo: () => {},
        });
        const chineseView = MinecraftWikiChineseSource.render({
            data: chineseData, currentUrl: "", navigateTo: () => {},
        });
        const view = composeTopicView(configured, [
            { model: MinecraftWikiSource, view: englishView },
            { model: MinecraftWikiChineseSource, view: chineseView },
        ]);
        const actions = view.search?.emptyActions ?? [];

        expect(actions.map(action => action.name)).toEqual([
            "Import Minecraft Wiki (English)", "Import Minecraft Wiki (中文)",
        ]);
        const input = [englishUrl, chineseUrl].join("\n");
        await actions[0]?.invoke(input);
        englishView.items["minecraft-wiki"]?.pageLayout?.create?.invoke("Reference");
        expect(chineseData).toEqual({ schemaVersion: 1, pinnedPages: [] });

        await actions[1]?.invoke(input);
        chineseView.items["minecraft-wiki-zh"]?.pageLayout?.create?.invoke("Brewing");
        const layout = MinecraftWikiChineseSource.render({
            data: chineseData, currentUrl: "", navigateTo: () => {},
        }).items["minecraft-wiki-zh"]?.pageLayout;
        layout?.reorder?.([
            { id: "", pageUrls: [] },
            { id: "collection:Brewing", pageUrls: [chineseUrl] },
        ]);

        expect({ englishData, chineseData }).toEqual({
            englishData: {
                schemaVersion: 1, pinnedPages: [englishUrl], collections: { Reference: { pages: [] } },
            },
            chineseData: {
                schemaVersion: 1, pinnedPages: [chineseUrl], collections: { Brewing: { pages: [chineseUrl] } },
            },
        });
    });

    test("creates reversible global keys and preserves source order", () => {
        const first = source("first", "https://first.example/");
        const second = source("second", "https://second.example/");
        const view = composeTopicView(topic([first, second]), [
            {
                model: first,
                view: {
                    items: {
                        shared: { id: "shared", name: "First", sortKey: "z", pages: [] },
                    },
                },
            },
            {
                model: second,
                view: {
                    items: {
                        shared: { id: "shared", name: "Second", sortKey: "a", pages: [] },
                    },
                },
            },
        ]);

        expect(Object.keys(view.items)).toEqual([
            createItemKey("first", "shared"),
            createItemKey("second", "shared"),
        ]);
        expect(Object.values(view.items).map(item => item.sortKey)).toEqual([
            "00000000:z",
            "00000001:a",
        ]);
    });

    test("aggregates ready source search actions and dispatches local IDs", () => {
        const selected: string[] = [];
        const first = source("first", "https://first.example/");
        const second = source("second", "https://second.example/");
        const configured = topic([first, second]);
        const ready = [first, second].map(model => ({
            model,
            view: {
                items: {
                    item: { id: "item", name: model.name, sortKey: "", pages: [] },
                },
                search: {
                    activeItemId: model === second ? "item" : undefined,
                    selectItem: (id: string) => selected.push(`${model.id}:${id}`),
                    getAddAction: (text: string) => ({
                        name: `${model.id}:${text}`,
                        icon: { type: "lucide" as const, icon: Plus },
                        invoke: () => {},
                    }),
                },
            },
        }));

        const view = composeTopicView(configured, ready);
        view.search?.selectItem(createItemKey("second", "item"));

        expect({
            active: view.search?.activeItemId,
            actions: view.search?.getAddActions("new").map(action => action.name),
            selected,
        }).toEqual({
            active: createItemKey("second", "item"),
            actions: ["first:new", "second:new"],
            selected: ["second:item"],
        });
    });
});
