import { describe, expect, test } from "bun:test";
import type { Page } from "@/core/data";
import { compileBookOutline } from "./book-outline";
import { createSectionLayout } from "./page-sections";

/** Minimal page fixture keeps pin/preview behavior visible in each test. */
function page(path: string, pinned: boolean | null = true): Page {
    return {
        name: { type: "text", text: path }, url: `https://example.com/${path}`,
        sortKey: path, current: pinned === false, pinned, setPinned() {},
    };
}

const outline = compileBookOutline([
    { path: "a.html", title: "A", ancestors: ["Chapter"] },
    { path: "b.html", title: "B", ancestors: ["Chapter"] },
    { path: "c.html", title: "C", ancestors: ["Chapter", "Nested"] },
    { path: "d.html", title: "D", ancestors: ["Chapter"] },
    { path: "e.html", title: "E", ancestors: [] },
]);

describe("ordered section spans", () => {
    test("preview occupies its natural position between pins", () => {
        const result = createSectionLayout([page("a.html"), page("c.html"), page("b.html", false)],
            url => outline.get(url.pathname.slice(1)) ?? null);
        expect(result.blocks.slice(2).map(block => block.pageUrls)).toEqual([
            ["https://example.com/a.html", "https://example.com/b.html"], ["https://example.com/c.html"],
        ]);
    });

    test("returning to a parent creates a new span; untitled pages stay in order", () => {
        const result = createSectionLayout([page("e.html"), page("d.html"), page("c.html"), page("a.html")],
            url => outline.get(url.pathname.slice(1)) ?? null);
        expect(result.blocks.slice(2).map(block => [block.titlePath, block.pageUrls])).toEqual([
            [["Chapter"], ["https://example.com/a.html"]],
            [["Chapter", "Nested"], ["https://example.com/c.html"]],
            [["Chapter"], ["https://example.com/d.html"]],
            [undefined, ["https://example.com/e.html"]],
        ]);
    });

    test("preview alone makes its known span visible and pinning keeps its location", () => {
        const resolve = (url: URL) => outline.get(url.pathname.slice(1)) ?? null;
        expect(createSectionLayout([page("c.html", false)], resolve).blocks)
            .toEqual(createSectionLayout([page("c.html", true)], resolve).blocks);
    });

    test("unknown pages and resolver failures stay loose without edit capabilities", () => {
        const result = createSectionLayout([page("index.html", null), page("missing.html"), page("new.html", false)],
            () => { throw new Error("Stale metadata"); });
        expect(result).toEqual({ blocks: [
            { id: "home", pageUrls: ["https://example.com/index.html"] },
            { id: "", pageUrls: ["https://example.com/missing.html", "https://example.com/new.html"] },
        ] });
    });

    test("unknown previews follow loose pins even when input order differs", () => {
        const result = createSectionLayout([
            page("new.html", false), page("missing-b.html"), page("missing-a.html"),
        ], () => null);
        expect(result.blocks[1]?.pageUrls).toEqual([
            "https://example.com/missing-b.html", "https://example.com/missing-a.html",
            "https://example.com/new.html",
        ]);
    });
});
