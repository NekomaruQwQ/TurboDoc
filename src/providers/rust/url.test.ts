/** biome-ignore-all lint/style/noNonNullAssertion: test code */

import { describe, expect, test } from "bun:test";
import { parseUrl, buildUrl, getBaseUrlForCrate, type CrateUrl } from "./url";

describe("getBaseUrlForCrate", () => {
    test("returns doc.rust-lang.org for std library crates", () => {
        expect(getBaseUrlForCrate("std")).toBe("https://doc.rust-lang.org/");
        expect(getBaseUrlForCrate("core")).toBe("https://doc.rust-lang.org/");
        expect(getBaseUrlForCrate("alloc")).toBe("https://doc.rust-lang.org/");
        expect(getBaseUrlForCrate("proc_macro")).toBe("https://doc.rust-lang.org/");
    });

    test("returns docs.rs for third-party crates", () => {
        expect(getBaseUrlForCrate("tokio")).toBe("https://docs.rs/");
        expect(getBaseUrlForCrate("serde")).toBe("https://docs.rs/");
        expect(getBaseUrlForCrate("bevy")).toBe("https://docs.rs/");
    });
});

describe("parseUrl - docs.rs", () => {
    test("parses URL with crate, version, and path", () => {
        const result = parseUrl("https://docs.rs/tokio/1.42.0/tokio/task/index.html");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            name: "tokio",
            version: "1.42.0",
            pathSegments: ["tokio", "task", "index.html"],
        });
    });

    test("parses URL with struct page", () => {
        const result = parseUrl("https://docs.rs/glam/0.28.0/glam/struct.Vec3.html");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            name: "glam",
            version: "0.28.0",
            pathSegments: ["glam", "struct.Vec3.html"],
        });
    });

    test("parses URL with 'latest' version", () => {
        const result = parseUrl("https://docs.rs/serde/latest/serde/index.html");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            name: "serde",
            version: "latest",
            pathSegments: ["serde", "index.html"],
        });
    });

    test("parses URL with pre-release version", () => {
        const result = parseUrl("https://docs.rs/bevy/0.15.0-rc.1/bevy/index.html");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            name: "bevy",
            version: "0.15.0-rc.1",
            pathSegments: ["bevy", "index.html"],
        });
    });

    test("parses URL with deeply nested path", () => {
        const result = parseUrl("https://docs.rs/tokio/1.42.0/tokio/sync/mpsc/struct.Sender.html");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            name: "tokio",
            version: "1.42.0",
            pathSegments: ["tokio", "sync", "mpsc", "struct.Sender.html"],
        });
    });

    test("parses URL with trailing slash (crate root)", () => {
        const result = parseUrl("https://docs.rs/tokio/1.42.0/");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            name: "tokio",
            version: "1.42.0",
            pathSegments: [""],
        });
    });

    test("parses URL without trailing slash", () => {
        const result = parseUrl("https://docs.rs/tokio/1.42.0");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            name: "tokio",
            version: "1.42.0",
            pathSegments: [],
        });
    });

    test("parses URL with only crate name (defaults version to 'latest')", () => {
        const result = parseUrl("https://docs.rs/tokio");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            name: "tokio",
            version: "latest",
            pathSegments: [],
        });
    });

    test("parses URL with fragment", () => {
        const result = parseUrl("https://docs.rs/tokio/1.42.0/tokio/runtime/struct.Runtime.html#method.block_on");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            name: "tokio",
            version: "1.42.0",
            pathSegments: ["tokio", "runtime", "struct.Runtime.html"],
            fragment: "method.block_on",
        });
    });

    test("parses URL with empty fragment", () => {
        // Empty fragment should be treated as undefined.
        const result = parseUrl("https://docs.rs/tokio/1.42.0/tokio/index.html#");
        expect(result).toEqual({
            baseUrl: "https://docs.rs/",
            name: "tokio",
            version: "1.42.0",
            pathSegments: ["tokio", "index.html"],
        });
    });

    test("returns null for docs.rs root", () => {
        expect(parseUrl("https://docs.rs/")).toBeNull();
    });

    test("returns null for docs.rs crate info page", () => {
        // These are crate metadata pages, not documentation.
        expect(parseUrl("https://docs.rs/crate/tokio/1.42.0")).toBeNull();
    });

    test("returns null for docs.rs internal pages", () => {
        expect(parseUrl("https://docs.rs/-/about")).toBeNull();
    });
});

describe("parseUrl - doc.rust-lang.org", () => {
    test("parses std URL without version prefix", () => {
        const result = parseUrl("https://doc.rust-lang.org/std/vec/struct.Vec.html");
        expect(result).toEqual({
            baseUrl: "https://doc.rust-lang.org/",
            name: "std",
            version: "stable",
            pathSegments: ["std", "vec", "struct.Vec.html"],
        });
    });

    test("parses core URL without version prefix", () => {
        const result = parseUrl("https://doc.rust-lang.org/core/option/enum.Option.html");
        expect(result).toEqual({
            baseUrl: "https://doc.rust-lang.org/",
            name: "core",
            version: "stable",
            pathSegments: ["core", "option", "enum.Option.html"],
        });
    });

    test("parses alloc URL without version prefix", () => {
        const result = parseUrl("https://doc.rust-lang.org/alloc/string/struct.String.html");
        expect(result).toEqual({
            baseUrl: "https://doc.rust-lang.org/",
            name: "alloc",
            version: "stable",
            pathSegments: ["alloc", "string", "struct.String.html"],
        });
    });

    test("parses proc_macro URL without version prefix", () => {
        const result = parseUrl("https://doc.rust-lang.org/proc_macro/struct.TokenStream.html");
        expect(result).toEqual({
            baseUrl: "https://doc.rust-lang.org/",
            name: "proc_macro",
            version: "stable",
            pathSegments: ["proc_macro", "struct.TokenStream.html"],
        });
    });

    test("parses URL with 'stable' version prefix", () => {
        const result = parseUrl("https://doc.rust-lang.org/stable/std/vec/struct.Vec.html");
        expect(result).toEqual({
            baseUrl: "https://doc.rust-lang.org/",
            name: "std",
            version: "stable",
            pathSegments: ["std", "vec", "struct.Vec.html"],
        });
    });

    test("parses URL with 'nightly' version prefix", () => {
        const result = parseUrl("https://doc.rust-lang.org/nightly/std/vec/struct.Vec.html");
        expect(result).toEqual({
            baseUrl: "https://doc.rust-lang.org/",
            name: "std",
            version: "nightly",
            pathSegments: ["std", "vec", "struct.Vec.html"],
        });
    });

    test("parses URL with fragment", () => {
        const result = parseUrl("https://doc.rust-lang.org/std/vec/struct.Vec.html#method.push");
        expect(result).toEqual({
            baseUrl: "https://doc.rust-lang.org/",
            name: "std",
            version: "stable",
            pathSegments: ["std", "vec", "struct.Vec.html"],
            fragment: "method.push",
        });
    });

    test("parses nightly URL with fragment", () => {
        const result = parseUrl("https://doc.rust-lang.org/nightly/core/option/enum.Option.html#variant.Some");
        expect(result).toEqual({
            baseUrl: "https://doc.rust-lang.org/",
            name: "core",
            version: "nightly",
            pathSegments: ["core", "option", "enum.Option.html"],
            fragment: "variant.Some",
        });
    });

    test("returns null for non-std-library paths", () => {
        // The Rust book, Cargo docs, etc. are not handled.
        expect(parseUrl("https://doc.rust-lang.org/book/")).toBeNull();
        expect(parseUrl("https://doc.rust-lang.org/cargo/")).toBeNull();
        expect(parseUrl("https://doc.rust-lang.org/rustc/")).toBeNull();
    });

    test("returns null for doc.rust-lang.org root", () => {
        expect(parseUrl("https://doc.rust-lang.org/")).toBeNull();
    });
});

describe("parseUrl - invalid URLs", () => {
    test("returns null for non-documentation URLs", () => {
        expect(parseUrl("https://crates.io/crates/tokio")).toBeNull();
        expect(parseUrl("https://github.com/tokio-rs/tokio")).toBeNull();
    });

    test("returns null for malformed URLs", () => {
        expect(parseUrl("not a url")).toBeNull();
        expect(parseUrl("")).toBeNull();
    });
});

describe("buildUrl - docs.rs", () => {
    test("builds URL with path ending in .html", () => {
        const crate: CrateUrl = {
            baseUrl: "https://docs.rs/",
            name: "tokio",
            version: "1.42.0",
            pathSegments: ["tokio", "task", "index.html"],
        };
        expect(buildUrl(crate)).toBe("https://docs.rs/tokio/1.42.0/tokio/task/index.html");
    });

    test("builds URL with path ending in /", () => {
        const crate: CrateUrl = {
            baseUrl: "https://docs.rs/",
            name: "tokio",
            version: "1.42.0",
            pathSegments: ["tokio", "task/"],
        };
        expect(buildUrl(crate)).toBe("https://docs.rs/tokio/1.42.0/tokio/task/");
    });

    test("builds URL and adds trailing slash for module paths", () => {
        const crate: CrateUrl = {
            baseUrl: "https://docs.rs/",
            name: "tokio",
            version: "1.42.0",
            pathSegments: ["tokio", "task"],
        };
        expect(buildUrl(crate)).toBe("https://docs.rs/tokio/1.42.0/tokio/task/");
    });

    test("builds URL with empty pathSegments (crate root)", () => {
        const crate: CrateUrl = {
            baseUrl: "https://docs.rs/",
            name: "glam",
            version: "0.28.0",
            pathSegments: [],
        };
        expect(buildUrl(crate)).toBe("https://docs.rs/glam/0.28.0/");
    });

    test("builds URL with 'latest' version", () => {
        const crate: CrateUrl = {
            baseUrl: "https://docs.rs/",
            name: "serde",
            version: "latest",
            pathSegments: ["serde", "index.html"],
        };
        expect(buildUrl(crate)).toBe("https://docs.rs/serde/latest/serde/index.html");
    });

    test("builds URL with fragment", () => {
        const crate: CrateUrl = {
            baseUrl: "https://docs.rs/",
            name: "tokio",
            version: "1.42.0",
            pathSegments: ["tokio", "runtime", "struct.Runtime.html"],
            fragment: "method.block_on",
        };
        expect(buildUrl(crate)).toBe("https://docs.rs/tokio/1.42.0/tokio/runtime/struct.Runtime.html#method.block_on");
    });

    test("builds URL without fragment when fragment is undefined", () => {
        const crate: CrateUrl = {
            baseUrl: "https://docs.rs/",
            name: "tokio",
            version: "1.42.0",
            pathSegments: ["tokio", "index.html"],
            fragment: undefined,
        };
        expect(buildUrl(crate)).toBe("https://docs.rs/tokio/1.42.0/tokio/index.html");
    });
});

describe("buildUrl - doc.rust-lang.org", () => {
    test("builds stable URL (no version prefix)", () => {
        const crate: CrateUrl = {
            baseUrl: "https://doc.rust-lang.org/",
            name: "std",
            version: "stable",
            pathSegments: ["std", "vec", "struct.Vec.html"],
        };
        expect(buildUrl(crate)).toBe("https://doc.rust-lang.org/std/vec/struct.Vec.html");
    });

    test("builds nightly URL (with version prefix)", () => {
        const crate: CrateUrl = {
            baseUrl: "https://doc.rust-lang.org/",
            name: "std",
            version: "nightly",
            pathSegments: ["std", "vec", "struct.Vec.html"],
        };
        expect(buildUrl(crate)).toBe("https://doc.rust-lang.org/nightly/std/vec/struct.Vec.html");
    });

    test("builds URL with fragment", () => {
        const crate: CrateUrl = {
            baseUrl: "https://doc.rust-lang.org/",
            name: "std",
            version: "stable",
            pathSegments: ["std", "vec", "struct.Vec.html"],
            fragment: "method.push",
        };
        expect(buildUrl(crate)).toBe("https://doc.rust-lang.org/std/vec/struct.Vec.html#method.push");
    });

    test("builds nightly URL with fragment", () => {
        const crate: CrateUrl = {
            baseUrl: "https://doc.rust-lang.org/",
            name: "core",
            version: "nightly",
            pathSegments: ["core", "option", "enum.Option.html"],
            fragment: "variant.Some",
        };
        expect(buildUrl(crate)).toBe("https://doc.rust-lang.org/nightly/core/option/enum.Option.html#variant.Some");
    });

    test("builds URL and adds trailing slash for module paths", () => {
        const crate: CrateUrl = {
            baseUrl: "https://doc.rust-lang.org/",
            name: "std",
            version: "stable",
            pathSegments: ["std", "collections"],
        };
        expect(buildUrl(crate)).toBe("https://doc.rust-lang.org/std/collections/");
    });
});

describe("roundtrip: parseUrl → buildUrl", () => {
    test("docs.rs URL without fragment", () => {
        const original = "https://docs.rs/tokio/1.42.0/tokio/task/index.html";
        const parsed = parseUrl(original)!;
        expect(buildUrl(parsed)).toBe(original);
    });

    test("docs.rs URL with fragment", () => {
        const original = "https://docs.rs/tokio/1.42.0/tokio/runtime/struct.Runtime.html#method.block_on";
        const parsed = parseUrl(original)!;
        expect(buildUrl(parsed)).toBe(original);
    });

    test("doc.rust-lang.org stable URL without fragment", () => {
        const original = "https://doc.rust-lang.org/std/vec/struct.Vec.html";
        const parsed = parseUrl(original)!;
        expect(buildUrl(parsed)).toBe(original);
    });

    test("doc.rust-lang.org stable URL with fragment", () => {
        const original = "https://doc.rust-lang.org/std/vec/struct.Vec.html#method.push";
        const parsed = parseUrl(original)!;
        expect(buildUrl(parsed)).toBe(original);
    });

    test("doc.rust-lang.org nightly URL", () => {
        const original = "https://doc.rust-lang.org/nightly/std/vec/struct.Vec.html";
        const parsed = parseUrl(original)!;
        expect(buildUrl(parsed)).toBe(original);
    });

    test("doc.rust-lang.org nightly URL with fragment", () => {
        const original = "https://doc.rust-lang.org/nightly/core/option/enum.Option.html#variant.Some";
        const parsed = parseUrl(original)!;
        expect(buildUrl(parsed)).toBe(original);
    });
});

describe("roundtrip: buildUrl → parseUrl", () => {
    test("docs.rs CrateUrl without fragment", () => {
        const crate: CrateUrl = {
            baseUrl: "https://docs.rs/",
            name: "serde",
            version: "1.0.0",
            pathSegments: ["serde", "de", "trait.Deserialize.html"],
        };
        const url = buildUrl(crate);
        expect(parseUrl(url)).toEqual(crate);
    });

    test("docs.rs CrateUrl with fragment", () => {
        const crate: CrateUrl = {
            baseUrl: "https://docs.rs/",
            name: "tokio",
            version: "1.42.0",
            pathSegments: ["tokio", "runtime", "struct.Runtime.html"],
            fragment: "method.block_on",
        };
        const url = buildUrl(crate);
        expect(parseUrl(url)).toEqual(crate);
    });

    test("doc.rust-lang.org CrateUrl (stable)", () => {
        const crate: CrateUrl = {
            baseUrl: "https://doc.rust-lang.org/",
            name: "std",
            version: "stable",
            pathSegments: ["std", "vec", "struct.Vec.html"],
        };
        const url = buildUrl(crate);
        expect(parseUrl(url)).toEqual(crate);
    });

    test("doc.rust-lang.org CrateUrl (nightly) with fragment", () => {
        const crate: CrateUrl = {
            baseUrl: "https://doc.rust-lang.org/",
            name: "core",
            version: "nightly",
            pathSegments: ["core", "option", "enum.Option.html"],
            fragment: "variant.Some",
        };
        const url = buildUrl(crate);
        expect(parseUrl(url)).toEqual(crate);
    });
});
