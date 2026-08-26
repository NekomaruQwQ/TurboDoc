import { describe, expect, test } from "bun:test";

import {
    MINECRAFT_WIKI_SITE,
    RUST_BOOK_SITE,
    WIKIPEDIA_SITE,
} from "./sites";

describe("configured site ownership", () => {
    test("accepts exact Wikipedia and Minecraft Wiki origins", () => {
        expect(WIKIPEDIA_SITE.ownsUrl(new URL(
            "https://en.wikipedia.org/wiki/Rust_(programming_language)",
        ))).toBeTrue();
        expect(MINECRAFT_WIKI_SITE.ownsUrl(new URL(
            "https://minecraft.wiki/w/Redstone",
        ))).toBeTrue();
    });

    test("rejects a lookalike Wikipedia hostname", () => {
        expect(WIKIPEDIA_SITE.ownsUrl(new URL(
            "https://en.wikipedia.org.example.com/wiki/Rust",
        ))).toBeFalse();
    });

    test("accepts Rust Book paths without claiming standard-library docs", () => {
        expect(RUST_BOOK_SITE.ownsUrl(new URL(
            "https://doc.rust-lang.org/stable/book/ch04-01-what-is-ownership.html",
        ))).toBeTrue();
        expect(RUST_BOOK_SITE.ownsUrl(new URL(
            "https://doc.rust-lang.org/stable/std/vec/struct.Vec.html",
        ))).toBeFalse();
    });

    test("normalizes the unversioned Rust Book alias", () => {
        const url = new URL(
            "https://doc.rust-lang.org/book/ch01-00-getting-started.html");

        RUST_BOOK_SITE.normalizeUrl?.(url);

        expect(url.href).toBe(
            "https://doc.rust-lang.org/stable/book/ch01-00-getting-started.html",
        );
    });
});

describe("configured page-name policies", () => {
    test("humanizes a Rust Book chapter filename", () => {
        expect(RUST_BOOK_SITE.resolvePageName(new URL(
            "https://doc.rust-lang.org/stable/book/ch04-01-what-is-ownership.html",
        ))).toBe("04-01 What Is Ownership");
    });

    test("decodes a MediaWiki article title", () => {
        expect(WIKIPEDIA_SITE.resolvePageName(new URL(
            "https://en.wikipedia.org/wiki/Rust_(programming_language)",
        ))).toBe("Rust (programming language)");
    });
});
