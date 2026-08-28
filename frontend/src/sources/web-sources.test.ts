import { describe, expect, test } from "bun:test";

import {
    MinecraftWikiDefinition,
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

    test.each([
        "https://zh.minecraft.wiki/w/%E8%8D%AF%E6%B0%B4%E9%85%BF%E9%80%A0?variant=zh-cn",
        "https://zh.minecraft.wiki/w/药水酿造?variant=zh-tw#材料",
        "https://zh.minecraft.wiki/w/index.php?title=药水酿造&variant=zh-cn",
    ])("accepts Chinese Minecraft Wiki URL %j", url => {
        expect(MinecraftWikiSource.matchUrl(url)).toBeTrue();
    });

    test.each([
        "https://minecraft.wiki.example.com/w/Redstone",
        "https://zh.minecraft.wiki.example.com/w/Redstone",
        "https://evilzh.minecraft.wiki/w/Redstone",
        "https://other.zh.minecraft.wiki/w/Redstone",
        "https://de.minecraft.wiki/w/Redstone",
        "http://zh.minecraft.wiki/w/Redstone",
        "https://zh.minecraft.wiki:8443/w/Redstone",
        "https://user:password@zh.minecraft.wiki/w/Redstone",
        "https://zh.minecraft.wiki@evil.example/w/Redstone",
    ])("rejects unsafe or unconfigured Minecraft Wiki URL %j", url => {
        expect(MinecraftWikiSource.matchUrl(url)).toBeFalse();
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

    test("decodes the Chinese Minecraft Wiki title without its variant or fragment", () => {
        expect(MinecraftWikiDefinition.rules.resolvePageName(new URL(
            "https://zh.minecraft.wiki/w/%E8%8D%AF%E6%B0%B4%E9%85%BF%E9%80%A0?variant=zh-cn#材料",
        ))).toBe("药水酿造");
    });
});
