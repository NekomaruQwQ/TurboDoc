import { describe, expect, test } from "bun:test";

import {
    DOC_SITES,
    getDocPageIdentity,
    getDocPageName,
    parseDocPageTarget,
} from "./sites";

describe("parseDocPageTarget", () => {
    test("accepts an English Wikipedia article", () => {
        expect(parseDocPageTarget(
            "https://en.wikipedia.org/wiki/Rust_(programming_language)",
        )?.site.id).toBe("wikipedia");
    });

    test("accepts a stable Rust Book chapter", () => {
        expect(parseDocPageTarget(
            "https://doc.rust-lang.org/stable/book/ch04-01-what-is-ownership.html",
        )?.site.id).toBe("rust-book");
    });

    test("normalizes the unversioned Rust Book alias", () => {
        expect(parseDocPageTarget(
            "https://doc.rust-lang.org/book/ch01-00-getting-started.html",
        )?.url).toBe(
            "https://doc.rust-lang.org/stable/book/ch01-00-getting-started.html",
        );
    });

    test("does not claim Rust standard-library documentation", () => {
        expect(parseDocPageTarget(
            "https://doc.rust-lang.org/stable/std/vec/struct.Vec.html",
        )).toBeNull();
    });

    test("rejects a lookalike Wikipedia hostname", () => {
        expect(parseDocPageTarget(
            "https://en.wikipedia.org.example.com/wiki/Rust",
        )).toBeNull();
    });

    test("rejects insecure supported hosts", () => {
        expect(parseDocPageTarget("http://minecraft.wiki/w/Redstone")).toBeNull();
    });
});

describe("getDocPageIdentity", () => {
    test("treats fragments as sections of the same page", () => {
        const page = "https://minecraft.wiki/w/Redstone";

        expect(getDocPageIdentity(`${page}#Signal_strength`)).toBe(
            getDocPageIdentity(`${page}#Power_sources`),
        );
    });

    test("treats both Rust Book root aliases as the fixed home page", () => {
        expect(getDocPageIdentity("https://doc.rust-lang.org/book")).toBe(
            getDocPageIdentity("https://doc.rust-lang.org/stable/book/"),
        );
    });
});

describe("getDocPageName", () => {
    test("humanizes a Rust Book chapter filename", () => {
        const site = DOC_SITES.find(candidate => candidate.id === "rust-book");

        expect(getDocPageName(
            // biome-ignore lint/style/noNonNullAssertion: fixed test catalog entry.
            site!,
            "https://doc.rust-lang.org/stable/book/ch04-01-what-is-ownership.html",
        )).toBe("What is ownership");
    });

    test("decodes a MediaWiki article title", () => {
        const site = DOC_SITES.find(candidate => candidate.id === "wikipedia");

        expect(getDocPageName(
            // biome-ignore lint/style/noNonNullAssertion: fixed test catalog entry.
            site!,
            "https://en.wikipedia.org/wiki/Rust_(programming_language)",
        )).toBe("Rust (programming language)");
    });
});
