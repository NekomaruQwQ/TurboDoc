import { describe, expect, test } from "bun:test";
import { resolveBookPageName, resolveRustBookPageName } from "../page-names";
import { BOOK_CATALOG } from "./catalog";
import {
    RustBookDefinitions,
    RustBookSource,
    RustBookSources,
} from ".";
import snapshots from "./outlines.generated.json";

describe("official Rust bookshelf", () => {
    test("all fifteen sources own distinct canonical homes and have complete outlines", () => {
        expect(RustBookSources).toHaveLength(15);
        for (const source of RustBookSources) {
            expect(RustBookSources
                .filter(candidate => candidate.matchUrl(source.homeUrl))
                .map(owner => owner.id)).toEqual([source.id]);
            const book = BOOK_CATALOG.find(book => book.id === source.id);
            expect(book).toBeDefined();
            for (const alias of book?.aliases ?? []) {
                const url = new URL(alias);
                const definition = RustBookDefinitions.find(
                    candidate => candidate.id === source.id);
                definition?.rules.normalizeUrl?.(url);
                expect(url.href).toBe(source.homeUrl);
            }
        }
        for (const snapshot of Object.values(snapshots)) {
            expect(snapshot.entries.length).toBeGreaterThan(0);
            expect(new Set(snapshot.entries.map(page => page.path)).size).toBe(snapshot.entries.length);
        }
    });

    test("book scopes reject lookalikes, sibling paths and Rustdoc", () => {
        for (const input of [
            "https://doc.rust-lang.org/stable/std/vec/struct.Vec.html",
            "https://doc.rust-lang.org/stable/bookshop/a.html",
            "https://rust-analyzer.github.io/bookshop/a.html",
            "https://rust-analyzer.github.io.example.com/book/a.html",
            "https://rust-lang.github.io/other-project/",
            "https://doc.rust-lang.org/stable/unstable-book/",
        ]) expect(RustBookSources.some(source => source.matchUrl(input))).toBeFalse();
    });

    test("known book preview resolves its full section ancestry", () => {
        const definition = RustBookDefinitions.find(source => source.id === "rust-book");
        expect(definition?.rules.resolvePagePlacement(
            new URL(`${RustBookSource.homeUrl}ch03-05-control-flow.html`))?.titlePath)
            .toEqual(["Common Programming Concepts"]);
    });
});

describe("URL-owned page naming", () => {
    test.each([
        ["ch03-05-control-flow.html", "03-05 Control Flow"],
        ["ch04-01-what-is-ownership.html", "04-01 What Is Ownership"],
        ["appendix-01-keywords.html", "Appendix 01 Keywords"],
        ["title-page.html", "Title Page"],
        ["some-HTTP-name.html", "Some HTTP Name"],
        ["bad-%ZZ.html", "Bad %ZZ"],
    ])("Rust Book %s becomes %s", (file, expected) => {
        expect(resolveRustBookPageName(new URL(`https://example.com/${file}?q=1#part`))).toBe(expected);
    });

    test("unnumbered nested index uses the directory name", () => {
        expect(resolveBookPageName(new URL("https://example.com/book/build_scripts/index.html")))
            .toBe("Build Scripts");
    });

    test("an empty filename has a safe fallback", () => {
        expect(resolveRustBookPageName(new URL("https://example.com/"))).toBe("Page");
    });
});
