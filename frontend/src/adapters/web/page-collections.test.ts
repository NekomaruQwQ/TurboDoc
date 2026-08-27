import { describe, expect, test } from "bun:test";
import type { Page } from "@/core/explorer";
import { createCollectionLayout, normalizePageCollections, type CollectionState } from "./page-collections";

/** Tiny canonical resolver models fragment-insensitive page identity. */
function resolvePage(input: string) {
    try {
        const url = new URL(input);
        if (url.origin !== "https://example.com") return null;
        const identity = new URL(url);
        identity.hash = "";
        return { sourceId: "example", url: url.href, identity: identity.href };
    } catch { return null; }
}

const a = "https://example.com/a#saved";
const b = "https://example.com/b";
const c = "https://example.com/c";

/** Mutable state fixture with a pure defensive read, like source derivation. */
function fixture(initial: CollectionState, pages: Page[] = []) {
    let state = structuredClone(initial);
    const render = () => createCollectionLayout(pages, () => structuredClone(state), next => {
        state = next;
    }, resolvePage);
    return { render, read: () => state };
}

describe("collection normalization", () => {
    test("ambiguous membership becomes loose without changing pin targets", () => {
        expect(normalizePageCollections([a, b, c], {
            Maths: { pages: ["https://example.com/a#different", b, b] },
            CS: { pages: [b, c, "https://other.com/no", "https://example.com/not-pinned"] },
        }, resolvePage)).toEqual({ Maths: { pages: [a] }, CS: { pages: [c] } });
    });

    test("malformed metadata keeps valid empty collections", () => {
        expect(normalizePageCollections([a], {
            Empty: null, Broken: { pages: 1 }, " ": { pages: [a] },
        }, resolvePage)).toEqual({ Empty: { pages: [] }, Broken: { pages: [] } });
    });

    test("non-object metadata does not claim pins", () => {
        expect(normalizePageCollections([a], [], resolvePage)).toEqual({});
    });
});

describe("collection composition and editing", () => {
    test("preview is between loose pins and alphabetically sorted collections", () => {
        const pages: Page[] = [
            { name: { type: "text", text: "Home" }, url: "https://example.com/", sortKey: "", current: false, pinned: null, setPinned() {} },
            { name: { type: "text", text: "Preview" }, url: c, sortKey: "", current: true, pinned: false, setPinned() {} },
        ];
        const f = fixture({ pinnedPages: [a, b], collections: {
            Maths: { pages: [b] }, CS: { pages: [] },
        } }, pages);
        expect(f.render().blocks.map(block => [block.id, block.pageUrls])).toEqual([
            ["home", ["https://example.com/"]], ["", [a]], ["preview", [c]],
            ["collection:CS", []], ["collection:Maths", [b]],
        ]);
    });

    test("rename relocates alphabetically without changing page order", () => {
        const f = fixture({ pinnedPages: [a, b], collections: { Maths: { pages: [b, a] }, CS: { pages: [] } } });
        f.render().blocks.find(block => block.id === "collection:Maths")?.rename?.invoke(" 01 Maths ");
        expect(f.render().blocks.filter(block => block.titlePath).map(block => [block.titlePath, block.pageUrls]))
            .toEqual([[["01 Maths"], [b, a]], [["CS"], []]]);
    });

    test("blank and duplicate names are rejected without state loss", () => {
        const f = fixture({ pinnedPages: [a], collections: { CS: { pages: [a] } } });
        const before = structuredClone(f.read());
        expect(f.render().create?.invoke(" ")).toHaveProperty("error");
        expect(f.render().create?.invoke(" CS ")).toHaveProperty("error");
        expect(f.read()).toEqual(before);
    });

    test("prototype-like and reserved UI names remain ordinary collection names", () => {
        const f = fixture({ pinnedPages: [], collections: {} });
        f.render().create?.invoke("__proto__");
        f.render().create?.invoke("preview");
        expect(Object.keys(f.read().collections)).toEqual(["__proto__", "preview"]);
    });

    test("removing a collection appends its pins to loose pages", () => {
        const f = fixture({ pinnedPages: [a, b, c], collections: { Maths: { pages: [c, a] } } });
        f.render().blocks.find(block => block.id === "collection:Maths")?.remove?.invoke();
        expect(f.render().blocks.find(block => block.id === "")?.pageUrls).toEqual([b, c, a]);
    });

    test("a cross-collection drop commits one complete permutation with saved fragments", () => {
        const f = fixture({ pinnedPages: [a, b, c], collections: { Maths: { pages: [b] }, CS: { pages: [c] } } });
        f.render().reorder?.([
            { id: "", pageUrls: [c] },
            { id: "collection:CS", pageUrls: ["https://example.com/a#new", b] },
            { id: "collection:Maths", pageUrls: [] },
        ]);
        expect(f.read()).toEqual({ pinnedPages: [c, a, b], collections: { Maths: { pages: [] }, CS: { pages: [a, b] } } });
    });

    test.each([
        [{ id: "", pageUrls: [a] }],
        [{ id: "", pageUrls: [a] }, { id: "collection:CS", pageUrls: [a] }],
        [{ id: "", pageUrls: [a] }, { id: "collection:missing", pageUrls: [b] }],
        [{ id: "", pageUrls: [a] }, { id: "", pageUrls: [b] }],
        [{ id: "", pageUrls: [a] }, { id: "collection:CS", pageUrls: [c] }],
    ].map(orders => ({ orders })))
        ("rejects incomplete, duplicate, unknown, or stale snapshots: %j", ({ orders }) => {
        const initial = { pinnedPages: [a, b], collections: { CS: { pages: [b] } } };
        const f = fixture(initial);
        f.render().reorder?.(orders);
        expect(f.read()).toEqual(initial);
    });
});
