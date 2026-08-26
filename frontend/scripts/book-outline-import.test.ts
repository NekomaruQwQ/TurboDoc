import { describe, expect, test } from "bun:test";
import { parseBookOutline } from "./book-outline-import";

describe("published mdBook outline import", () => {
    test("reads old and new link wrappers, ancestry, entities and non-page toggles", () => {
        const html = `<ol class="chapter">
            <li class="chapter-item"><a href="index.html">Home</a></li>
            <li class="part-title">Part &amp; More</li>
            <li class="chapter-item"><span><a href="parent.html"><strong>1.</strong> Parent</a></span><a class="chapter-fold-toggle"></a></li>
            <ol class="section"><li class="chapter-item"><a href="child.html"><strong>1.1.</strong> Child</a></li>
                <ol class="section"><li class="chapter-item"><a href="nested.html">Nested</a></li></ol>
                <li class="chapter-item"><a href="sibling.html">Sibling</a></li>
            </ol>
        </ol>`;
        expect(parseBookOutline(html, "https://example.com/book/")).toEqual([
            { path: "index.html", title: "Home", ancestors: [] },
            { path: "parent.html", title: "Parent", ancestors: ["Part & More"] },
            { path: "child.html", title: "Child", ancestors: ["Part & More", "Parent"] },
            { path: "nested.html", title: "Nested", ancestors: ["Part & More", "Parent", "Child"] },
            { path: "sibling.html", title: "Sibling", ancestors: ["Part & More", "Parent"] },
        ]);
    });

    test.each(["https://other.com/x.html", "../x.html", "a.html#fragment", "a.html?q=1", "toc.html", "file.js"])
        ("rejects unowned or non-page target %s", href => {
            expect(() => parseBookOutline(`<ol class="chapter"><li class="chapter-item"><a href="${href}">Title</a></li></ol>`,
                "https://example.com/book/")).toThrow();
        });

    test("rejects a duplicate page rather than producing ambiguous placement", () => {
        expect(() => parseBookOutline(`<ol class="chapter"><li class="chapter-item"><a href="a.html">A</a><a href="a.html">Again</a></li></ol>`,
            "https://example.com/book/")).toThrow("Duplicate chapter path");
    });

    test("rejects a missing outline rather than replacing the snapshot", () => {
        expect(() => parseBookOutline("<html>Unavailable</html>", "https://example.com/book/")).toThrow();
    });
});
