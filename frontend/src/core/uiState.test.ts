import { describe, expect, test } from "bun:test";

import { createItemKey } from "@/core/itemKey";
import type { SourceModel } from "@/core/source";
import type { Topic } from "@/core/topic";
import {
    initializeUiState,
    reconcileTopicUiState,
} from "@/core/uiState.svelte";

/** Minimal in-memory implementation of the browser Storage contract. */
class MemoryStorage implements Storage {
    readonly #values = new Map<string, string>();
    /** Physical writes used to verify idempotent reconciliation. */
    readonly writes: string[] = [];
    /** Physical removals used to verify namespace pruning. */
    readonly removals: string[] = [];

    /** Seed storage with already serialized browser values. */
    constructor(values: Record<string, string> = {}) {
        for (const [key, value] of Object.entries(values))
            this.#values.set(key, value);
    }

    /** Number of physical keys currently stored. */
    get length(): number { return this.#values.size; }

    /** Remove all values, matching the browser Storage API. */
    clear(): void { this.#values.clear(); }

    /** Return one serialized value or null when absent. */
    getItem(key: string): string | null { return this.#values.get(key) ?? null; }

    /** Return the key at a stable insertion-order index. */
    key(index: number): string | null {
        return [...this.#values.keys()][index] ?? null;
    }

    /** Remove one value and record successful physical removals. */
    removeItem(key: string): void {
        if (this.#values.delete(key)) this.removals.push(key);
    }

    /** Store one serialized value and record the physical write. */
    setItem(key: string, value: string): void {
        this.#values.set(key, value);
        this.writes.push(key);
    }

    /** Reset mutation observations without changing stored values. */
    resetObservations(): void {
        this.writes.length = 0;
        this.removals.length = 0;
    }
}

/** Build the smallest source model needed by UI-state ownership checks. */
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
        matchUrl(input) {
            try {
                return new URL(input).origin === new URL(origin).origin;
            } catch {
                return false;
            }
        },
        render: () => ({ items: {} }),
    };
}

/** Build one test topic around the supplied registered sources. */
function topic(sources: readonly SourceModel[]): Topic {
    const home = sources[0];
    if (!home) throw new Error("Test topic requires a source.");
    return {
        id: "topic",
        name: "Topic",
        icon: { type: "monochrome-svg", src: "topic.svg" },
        homeSourceId: home.id,
        sources,
        search: { placeholder: "Search", invalidText: "No match" },
    };
}

/** Decode one JSON slot for compact state assertions. */
function readJson(storage: Storage, key: string): unknown {
    const value = storage.getItem(key);
    return value === null ? undefined : JSON.parse(value);
}

describe("local UI-state initialization", () => {
    test("prunes the owned namespace and canonicalizes current slots", () => {
        const primary = source("primary", "https://primary.example/");
        const secondary = source("secondary", "https://secondary.example/");
        const configuredTopic = topic([primary, secondary]);
        const primaryItems = Array.from({ length: 6 }, (_, index) =>
            createItemKey(primary.id, `item-${index}`));
        const secondaryItem = createItemKey(secondary.id, "retained");
        const removedSourceItem = createItemKey("removed-source", "stale");
        const storage = new MemoryStorage({
            "turbodoc:ui-state": "{}",
            "turbodoc:future-slot": "true",
            "third-party:state": "keep me",
            "turbodoc:active-topic-id": JSON.stringify("removed-topic"),
            "turbodoc:current-url": JSON.stringify("https://removed.example/"),
            "turbodoc:expanded-v2": JSON.stringify([
                `${configuredTopic.id}:item:${primaryItems[0]}`,
                `${configuredTopic.id}:item:${primaryItems[0]}`,
                `${configuredTopic.id}:item:${secondaryItem}`,
                `${configuredTopic.id}:item:${removedSourceItem}`,
                `${configuredTopic.id}:group:group:with:colons`,
                "removed-topic:group:stale",
                "malformed",
                42,
            ]),
            "turbodoc:recent-items-v2": JSON.stringify({
                [configuredTopic.id]: [
                    primaryItems[0],
                    primaryItems[0],
                    ...primaryItems.slice(1),
                    secondaryItem,
                    removedSourceItem,
                    "malformed",
                ],
                "removed-topic": [primaryItems[0]],
                malformedBucket: "not-an-array",
            }),
        });

        expect(initializeUiState([configuredTopic], storage)).toEqual({
            activeTopicId: configuredTopic.id,
            currentUrl: primary.homeUrl,
        });
        expect(storage.getItem("turbodoc:ui-state")).toBeNull();
        expect(storage.getItem("turbodoc:future-slot")).toBeNull();
        expect(storage.getItem("third-party:state")).toBe("keep me");
        expect(readJson(storage, "turbodoc:expanded-v2")).toEqual([
            `${configuredTopic.id}:group:group:with:colons`,
            `${configuredTopic.id}:item:${primaryItems[0]}`,
            `${configuredTopic.id}:item:${secondaryItem}`,
        ]);
        expect(readJson(storage, "turbodoc:recent-items-v2")).toEqual({
            [configuredTopic.id]: primaryItems.slice(0, 5),
        });
    });

    test("repairs corrupt current slots and is idempotent afterward", () => {
        const configuredTopic = topic([
            source("primary", "https://primary.example/"),
        ]);
        const storage = new MemoryStorage({
            "turbodoc:active-topic-id": "not-json",
            "turbodoc:current-url": "[]",
            "turbodoc:expanded-v2": "{}",
            "turbodoc:recent-items-v2": "[]",
        });

        initializeUiState([configuredTopic], storage);
        storage.resetObservations();
        initializeUiState([configuredTopic], storage);

        expect(storage.writes).toEqual([]);
        expect(storage.removals).toEqual([]);
        expect(readJson(storage, "turbodoc:active-topic-id"))
            .toBe(configuredTopic.id);
        expect(readJson(storage, "turbodoc:current-url"))
            .toBe(configuredTopic.sources[0]?.homeUrl);
        expect(readJson(storage, "turbodoc:expanded-v2")).toEqual([]);
        expect(readJson(storage, "turbodoc:recent-items-v2")).toEqual({});
    });
});

describe("ready-source UI-state reconciliation", () => {
    test("removes proven stale references and preserves unavailable sources", () => {
        const ready = source("ready", "https://ready.example/");
        const unavailable = source("unavailable", "https://unavailable.example/");
        const configuredTopic = topic([ready, unavailable]);
        const readyValid = createItemKey(ready.id, "valid");
        const readyStale = createItemKey(ready.id, "stale");
        const unavailableItem = createItemKey(unavailable.id, "not-loaded");
        const storage = new MemoryStorage({
            "turbodoc:active-topic-id": JSON.stringify(configuredTopic.id),
            "turbodoc:current-url": JSON.stringify(ready.homeUrl),
            "turbodoc:recent-items-v2": JSON.stringify({
                [configuredTopic.id]: [readyStale, unavailableItem, readyValid],
            }),
            "turbodoc:expanded-v2": JSON.stringify([
                `${configuredTopic.id}:group:`,
                `${configuredTopic.id}:group:kept`,
                `${configuredTopic.id}:group:deleted`,
                `${configuredTopic.id}:item:${readyValid}`,
                `${configuredTopic.id}:item:${readyStale}`,
                `${configuredTopic.id}:item:${unavailableItem}`,
            ]),
        });
        initializeUiState([configuredTopic], storage);

        reconcileTopicUiState({
            topic: configuredTopic,
            readySourceIds: [ready.id],
            validItemIds: [readyValid],
            groupNames: ["kept"],
        }, storage);

        expect(readJson(storage, "turbodoc:recent-items-v2")).toEqual({
            [configuredTopic.id]: [unavailableItem, readyValid],
        });
        expect(readJson(storage, "turbodoc:expanded-v2")).toEqual([
            `${configuredTopic.id}:group:`,
            `${configuredTopic.id}:group:kept`,
            `${configuredTopic.id}:item:${readyValid}`,
            `${configuredTopic.id}:item:${unavailableItem}`,
        ]);
    });
});
