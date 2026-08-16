import { describe, expect, test } from "bun:test";

import type { Provider } from "./data";
import { findProviderForUrl } from "./providerRouting";
import { parseDocPageTarget } from "@/providers/doc/sites";
import { parseUrl as parseRustUrl } from "@/providers/rust/url";

/** Build the narrow provider surface needed by the routing algorithm. */
function provider(
    id: string,
    ownedOrigin: string,
    ownsUrl = (url: string) => new URL(url).origin === new URL(ownedOrigin).origin,
): Provider {
    return {
        id,
        name: id,
        icon: { type: "monochrome-svg", src: "test.svg" },
        homeUrl: ownedOrigin,
        enableItemGrouping: false,
        renderItemNameAsCode: false,
        renderPageNameAsCode: false,
        ownsUrl,
        render: () => ({ items: {} }),
    };
}

describe("findProviderForUrl", () => {
    test("returns the provider that owns the navigation", () => {
        const rust = provider("rust", "https://docs.rs/");
        const doc = provider("doc", "https://en.wikipedia.org/");

        expect(findProviderForUrl(
            [rust, doc],
            "https://en.wikipedia.org/wiki/Rust_(programming_language)",
        )).toBe(doc);
    });

    test("uses registration order as the overlap tie-breaker", () => {
        const first = provider("first", "https://example.com/");
        const second = provider("second", "https://example.com/");

        expect(findProviderForUrl(
            [first, second],
            "https://example.com/reference",
        )).toBe(first);
    });

    test("returns undefined for an unsupported navigation", () => {
        const rust = provider("rust", "https://docs.rs/");

        expect(findProviderForUrl([rust], "https://example.com/")).toBeUndefined();
    });

    test("routes Rust Book and standard-library paths to disjoint providers", () => {
        const rust = provider(
            "rust",
            "https://docs.rs/",
            url => parseRustUrl(url) !== null);
        const doc = provider(
            "doc",
            "https://en.wikipedia.org/",
            url => parseDocPageTarget(url) !== null);

        expect([
            findProviderForUrl(
                [rust, doc],
                "https://doc.rust-lang.org/stable/book/ch04-01-what-is-ownership.html",
            )?.id,
            findProviderForUrl(
                [rust, doc],
                "https://doc.rust-lang.org/stable/std/vec/struct.Vec.html",
            )?.id,
        ]).toEqual(["doc", "rust"]);
    });
});
