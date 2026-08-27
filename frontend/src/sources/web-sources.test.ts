import { describe, expect, test } from "bun:test";

import {
    MinecraftWikiSource,
    WikipediaDefinition,
    WikipediaSource,
} from "./web-sources";
import { RustBookDefinitions, RustBookSource } from "./rust-books";

describe("configured source ownership", () => {
    test("accepts exact Wikipedia and Minecraft Wiki origins", () => {
        expect(WikipediaSource.matchUrl(
            "https://en.wikipedia.org/wiki/Rust_(programming_language)",
        )).toBeTrue();
        expect(MinecraftWikiSource.matchUrl(
            "https://minecraft.wiki/w/Redstone",
        )).toBeTrue();
    });

    test("rejects a lookalike Wikipedia hostname", () => {
        expect(WikipediaSource.matchUrl(
            "https://en.wikipedia.org.example.com/wiki/Rust",
        )).toBeFalse();
    });

    test("accepts Rust Book paths without claiming standard-library docs", () => {
        expect(RustBookSource.matchUrl(
            "https://doc.rust-lang.org/stable/book/ch04-01-what-is-ownership.html",
        )).toBeTrue();
        expect(RustBookSource.matchUrl(
            "https://doc.rust-lang.org/stable/std/vec/struct.Vec.html",
        )).toBeFalse();
    });

    test("normalizes the unversioned Rust Book alias", () => {
        const url = new URL(
            "https://doc.rust-lang.org/book/ch01-00-getting-started.html");

        RustBookDefinitions
            .find(source => source.id === RustBookSource.id)
            ?.rules.normalizeUrl?.(url);

        expect(url.href).toBe(
            "https://doc.rust-lang.org/stable/book/ch01-00-getting-started.html",
        );
    });
});

describe("configured page-name policies", () => {
    test("humanizes a Rust Book chapter filename", () => {
        expect(RustBookDefinitions
            .find(source => source.id === RustBookSource.id)
            ?.rules.resolvePageName(new URL(
                "https://doc.rust-lang.org/stable/book/ch04-01-what-is-ownership.html",
            ))).toBe("04-01 What Is Ownership");
    });

    test("decodes a MediaWiki article title", () => {
        expect(WikipediaDefinition.rules.resolvePageName(new URL(
            "https://en.wikipedia.org/wiki/Rust_(programming_language)",
        ))).toBe("Rust (programming language)");
    });
});
