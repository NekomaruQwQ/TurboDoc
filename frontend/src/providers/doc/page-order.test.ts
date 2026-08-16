import { describe, expect, test } from "bun:test";

import { normalizePinnedPages, reorderPinnedPages } from "./page-order";

const HOME = "https://minecraft.wiki/";
const REDSTONE = "https://minecraft.wiki/w/Redstone";
const CREEPER = "https://minecraft.wiki/w/Creeper";

describe("normalizePinnedPages", () => {
    test("keeps valid unique pages in persisted order", () => {
        expect(normalizePinnedPages("minecraft-wiki", HOME, [
            CREEPER,
            `${REDSTONE}#Power_sources`,
            `${REDSTONE}#Signal_strength`,
        ])).toEqual([CREEPER, `${REDSTONE}#Power_sources`]);
    });

    test("removes home, foreign, and unsupported targets", () => {
        expect(normalizePinnedPages("minecraft-wiki", HOME, [
            HOME,
            "https://en.wikipedia.org/wiki/Creeper",
            "https://example.com/guide",
        ])).toEqual([]);
    });
});

describe("reorderPinnedPages", () => {
    test("returns the requested valid permutation", () => {
        expect(reorderPinnedPages(
            [REDSTONE, CREEPER],
            [CREEPER, REDSTONE],
        )).toEqual([CREEPER, REDSTONE]);
    });

    test("preserves the original section target for an equivalent identity", () => {
        const pinned = `${REDSTONE}#Power_sources`;

        expect(reorderPinnedPages(
            [pinned, CREEPER],
            [CREEPER, `${REDSTONE}#Signal_strength`],
        )).toEqual([CREEPER, pinned]);
    });

    test("rejects a stale partial drag result", () => {
        expect(reorderPinnedPages([REDSTONE, CREEPER], [CREEPER])).toBeNull();
    });

    test("rejects duplicate requested pages", () => {
        expect(reorderPinnedPages(
            [REDSTONE, CREEPER],
            [CREEPER, CREEPER],
        )).toBeNull();
    });
});
