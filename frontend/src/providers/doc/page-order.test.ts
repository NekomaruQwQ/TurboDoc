import { describe, expect, test } from "bun:test";

import {
    normalizePinnedPages,
    reorderPinnedPages,
    type ResolvedDocPage,
} from "./page-order";

const HOME = "https://minecraft.wiki/";
const REDSTONE = "https://minecraft.wiki/w/Redstone";
const CREEPER = "https://minecraft.wiki/w/Creeper";

/** Resolve the two exact test origins without depending on a provider catalog. */
function resolvePage(input: string): ResolvedDocPage | null {
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        return null;
    }
    if (url.protocol !== "https:") return null;

    const siteId = url.origin === "https://minecraft.wiki"
        ? "minecraft-wiki"
        : url.origin === "https://en.wikipedia.org"
            ? "wikipedia"
            : null;
    if (!siteId) return null;

    const identity = new URL(url.href);
    identity.hash = "";
    return { siteId, url: url.href, identity: identity.href };
}

describe("normalizePinnedPages", () => {
    test("keeps valid unique pages in persisted order", () => {
        expect(normalizePinnedPages("minecraft-wiki", HOME, [
            CREEPER,
            `${REDSTONE}#Power_sources`,
            `${REDSTONE}#Signal_strength`,
        ], resolvePage)).toEqual([CREEPER, `${REDSTONE}#Power_sources`]);
    });

    test("removes home, foreign, and unsupported targets", () => {
        expect(normalizePinnedPages("minecraft-wiki", HOME, [
            HOME,
            "https://en.wikipedia.org/wiki/Creeper",
            "https://example.com/guide",
        ], resolvePage)).toEqual([]);
    });

    test("tolerates malformed persisted lists without losing valid entries", () => {
        for (const value of [null, "not an array", { pages: [REDSTONE] }]) {
            expect(normalizePinnedPages("minecraft-wiki", HOME, value, resolvePage)).toEqual([]);
        }
        expect(normalizePinnedPages("minecraft-wiki", HOME,
            [null, 42, {}, REDSTONE, false, CREEPER], resolvePage)).toEqual([REDSTONE, CREEPER]);
    });
});

describe("reorderPinnedPages", () => {
    test("returns the requested valid permutation", () => {
        expect(reorderPinnedPages(
            [REDSTONE, CREEPER],
            [CREEPER, REDSTONE],
            resolvePage,
        )).toEqual([CREEPER, REDSTONE]);
    });

    test("preserves the original section target for an equivalent identity", () => {
        const pinned = `${REDSTONE}#Power_sources`;

        expect(reorderPinnedPages(
            [pinned, CREEPER],
            [CREEPER, `${REDSTONE}#Signal_strength`],
            resolvePage,
        )).toEqual([CREEPER, pinned]);
    });

    test("rejects a stale partial drag result", () => {
        expect(reorderPinnedPages(
            [REDSTONE, CREEPER],
            [CREEPER],
            resolvePage,
        )).toBeNull();
    });

    test("rejects duplicate requested pages", () => {
        expect(reorderPinnedPages(
            [REDSTONE, CREEPER],
            [CREEPER, CREEPER],
            resolvePage,
        )).toBeNull();
    });

    test("rejects a foreign page in the requested order", () => {
        expect(reorderPinnedPages(
            [REDSTONE, CREEPER],
            [CREEPER, "https://en.wikipedia.org/wiki/Redstone"],
            resolvePage,
        )).toBeNull();
    });
});
