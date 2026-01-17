import { describe, expect, test } from "bun:test";
import { parseUrl, buildUrl, type KnownUrl } from "./url";

describe("parseUrl", () => {
    test("parses valid docs.rs URL with page path", () => {
        const result = parseUrl("https://docs.rs/tokio/1.42.0/tokio/task/index.html");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            crateName: "tokio",
            crateVersion: "1.42.0",
            pathSegments: ["tokio", "task", "index.html"],
        });
    });

    test("parses docs.rs URL with struct page", () => {
        const result = parseUrl("https://docs.rs/glam/0.28.0/glam/struct.Vec3.html");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            crateName: "glam",
            crateVersion: "0.28.0",
            pathSegments: ["glam", "struct.Vec3.html"],
        });
    });

    test("parses docs.rs URL with 'latest' version", () => {
        const result = parseUrl("https://docs.rs/serde/latest/serde/index.html");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            crateName: "serde",
            crateVersion: "latest",
            pathSegments: ["serde", "index.html"],
        });
    });

    test("parses docs.rs URL with deeply nested page path", () => {
        const result = parseUrl("https://docs.rs/tokio/1.42.0/tokio/sync/mpsc/struct.Sender.html");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            crateName: "tokio",
            crateVersion: "1.42.0",
            pathSegments: ["tokio", "sync", "mpsc", "struct.Sender.html"],
        });
    });

    test("parses docs.rs URL with pre-release version", () => {
        const result = parseUrl("https://docs.rs/bevy/0.15.0-rc.1/bevy/index.html");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            crateName: "bevy",
            crateVersion: "0.15.0-rc.1",
            pathSegments: ["bevy", "index.html"],
        });
    });

    test("returns PageUnknown for non-docs.rs URL", () => {
        const result = parseUrl("https://crates.io/crates/tokio");
        expect(result).toEqual(null);
    });

    test("parses docs.rs URL without page path (crate root)", () => {
        const result = parseUrl("https://docs.rs/tokio/1.42.0/");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            crateName: "tokio",
            crateVersion: "1.42.0",
            pathSegments: [""],
        });
    });

    test("parses docs.rs URL with only crate and version (no trailing slash)", () => {
        const result = parseUrl("https://docs.rs/tokio/1.42.0");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            crateName: "tokio",
            crateVersion: "1.42.0",
            pathSegments: [],
        });
    });

    test("returns PageUnknown for invalid URL", () => {
        const result = parseUrl("not a url");
        expect(result).toEqual(null);
    });

    test("returns PageUnknown for docs.rs root", () => {
        const result = parseUrl("https://docs.rs/");
        expect(result).toEqual(null);
    });

    test("parses docs.rs URL with only crate name (defaults version to latest)", () => {
        const result = parseUrl("https://docs.rs/tokio");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            crateName: "tokio",
            crateVersion: null,
            pathSegments: [],
        });
    });
});

describe("buildUrl", () => {
    test("builds URL for PageCrate with page path", () => {
        const page: KnownUrl = {
            baseUrl: "https://docs.rs/",
            crateName: "tokio",
            crateVersion: "1.42.0",
            pathSegments: ["tokio", "task", "index.html"],
        };
        expect(buildUrl(page)).toBe("https://docs.rs/tokio/1.42.0/tokio/task/index.html");
    });

    test("builds URL for PageCrate with struct page", () => {
        const page: KnownUrl = {
            baseUrl: "https://docs.rs/",
            crateName: "glam",
            crateVersion: "0.28.0",
            pathSegments: ["glam", "struct.Vec3.html"],
        };
        expect(buildUrl(page)).toBe("https://docs.rs/glam/0.28.0/glam/struct.Vec3.html");
    });

    test("builds URL for PageCrate with 'latest' version", () => {
        const page: KnownUrl = {
            baseUrl: "https://docs.rs/",
            crateName: "serde",
            crateVersion: "latest",
            pathSegments: ["serde", "index.html"],
        };
        expect(buildUrl(page)).toBe("https://docs.rs/serde/latest/serde/index.html");
    });

    test("builds URL for PageCrate with pre-release version", () => {
        const page: KnownUrl = {
            baseUrl: "https://docs.rs/",
            crateName: "bevy",
            crateVersion: "0.15.0-rc.1",
            pathSegments: ["bevy", "index.html"],
        };
        expect(buildUrl(page)).toBe("https://docs.rs/bevy/0.15.0-rc.1/bevy/index.html");
    });

    test("builds URL for PageCrate with deeply nested page", () => {
        const page: KnownUrl = {
            baseUrl: "https://docs.rs/",
            crateName: "tokio",
            crateVersion: "1.42.0",
            pathSegments: ["tokio", "sync", "mpsc", "struct.Sender.html"],
        };
        expect(buildUrl(page)).toBe("https://docs.rs/tokio/1.42.0/tokio/sync/mpsc/struct.Sender.html");
    });

    test("builds URL for PageCrate with empty pathSegments (crate root)", () => {
        const page: KnownUrl = {
            baseUrl: "https://docs.rs/",
            crateName: "glam",
            crateVersion: "0.28.0",
            pathSegments: [],
        };
        expect(buildUrl(page)).toBe("https://docs.rs/glam/0.28.0/");
    });
});

describe("parseUrl and buildUrl roundtrip", () => {
    test("roundtrip: parse then build returns equivalent URL", () => {
        const original = "https://docs.rs/tokio/1.42.0/tokio/task/index.html";
        const parsed = parseUrl(original);
        expect(parsed?.baseUrl).toBe("https://docs.rs/");

        const rebuilt = buildUrl(parsed!);
        expect(rebuilt).toBe(original);
    });

    test("roundtrip: build then parse returns same data", () => {
        const page: KnownUrl = {
            baseUrl: "https://docs.rs/",
            crateName: "serde",
            crateVersion: "1.0.0",
            pathSegments: ["serde", "de", "trait.Deserialize.html"],
        };

        const url = buildUrl(page);
        const parsed = parseUrl(url);

        expect(parsed).toEqual(page);
    });
});
