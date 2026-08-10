import { describe, expect, test } from "bun:test";

import type { Item } from "@/core/data";
import {
    buildItemSearchIndex,
    findExactItem,
    findPrefixItems,
    recordRecentItemId,
    resolveRecentItems,
} from "@/core/itemSearch";

/** Construct the smallest valid item needed by the rune-independent helpers. */
function createItem(name: string, sortKey = name): Item {
    return {
        id: name,
        name,
        sortKey,
        pages: [],
    };
}

describe("item prefix search", () => {
    test("matches trimmed prefixes case-insensitively in sort-key order", () => {
        const index = buildItemSearchIndex({
            serde_json: createItem("serde_json"),
            ron: createItem("ron"),
            serde: createItem("serde"),
            serde_repr: createItem("serde_repr"),
        });

        expect(findPrefixItems(index, "  SeRdE ").map(entry => entry.id)).toEqual([
            "serde",
            "serde_json",
            "serde_repr",
        ]);
        expect(findPrefixItems(index, "erde")).toEqual([]);
        expect(findPrefixItems(index, "   ")).toEqual([]);
    });

    test("returns only the first five matches", () => {
        const items = Object.fromEntries(
            Array.from({ length: 7 }, (_, index) => {
                const name = `serde_${index}`;
                return [name, createItem(name)];
            }));

        expect(findPrefixItems(buildItemSearchIndex(items), "serde").map(entry => entry.id))
            .toEqual(["serde_0", "serde_1", "serde_2", "serde_3", "serde_4"]);
    });

    test("finds exact names without regard to input case", () => {
        const index = buildItemSearchIndex({ serde: createItem("serde") });

        expect(findExactItem(index, "SERDE")?.id).toBe("serde");
        expect(findExactItem(index, "ser")).toBeUndefined();
    });
});

describe("recent item history", () => {
    test("preserves access order and skips deleted IDs", () => {
        const index = buildItemSearchIndex({
            serde: createItem("serde"),
            tokio: createItem("tokio"),
            anyhow: createItem("anyhow"),
        });

        expect(resolveRecentItems(
            index,
            ["tokio", "deleted", "serde", "tokio", "anyhow"])
            .map(entry => entry.id))
            .toEqual(["tokio", "serde", "anyhow"]);
    });

    test("moves an accessed item to the front, deduplicates, and caps at five", () => {
        expect(recordRecentItemId(
            ["serde", "tokio", "anyhow", "bevy", "glam", "tracing"],
            "bevy"))
            .toEqual(["bevy", "serde", "tokio", "anyhow", "glam"]);
    });

    test("returns the same array when an MRU list is already canonical", () => {
        const recent = ["serde", "tokio"];

        expect(recordRecentItemId(recent, "serde")).toBe(recent);
    });

    test("repairs duplicates unrelated to the accessed item", () => {
        expect(recordRecentItemId(["serde", "tokio", "tokio"], "serde"))
            .toEqual(["serde", "tokio"]);
    });
});
