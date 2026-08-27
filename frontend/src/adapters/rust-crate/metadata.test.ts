import { describe, expect, test } from "bun:test";

import {
    getCratesApiUrl,
    getCratesIndexUrl,
    parseCratesApi,
    parseCratesIndex,
} from "./metadata";

describe("getCratesIndexUrl", () => {
    test.each([
        ["a", "https://index.crates.io/1/a"],
        ["ab", "https://index.crates.io/2/ab"],
        ["abc", "https://index.crates.io/3/a/abc"],
        ["tokio", "https://index.crates.io/to/ki/tokio"],
        ["Serde_JSON", "https://index.crates.io/se/rd/serde_json"],
    ])("maps %s to its Cargo index path", (name, expected) => {
        expect(getCratesIndexUrl(name)).toBe(expected);
    });

    test.each(["", "1crate", "crate/name", "crate.name", `a${"b".repeat(64)}`])(
        "rejects invalid crate name %s",
        name => { expect(() => getCratesIndexUrl(name)).toThrow(); });
});

test("getCratesApiUrl validates and normalizes crate names", () => {
    expect(getCratesApiUrl("Tokio")).toBe("https://crates.io/api/v1/crates/tokio");
    expect(() => getCratesApiUrl("../tokio")).toThrow();
});

describe("parseCratesIndex", () => {
    test("normalizes newline-delimited versions and ignores resolution fields", () => {
        const metadata = parseCratesIndex("tokio", [
            JSON.stringify({ name: "tokio", vers: "1.0.0", yanked: true, deps: [] }),
            JSON.stringify({ name: "tokio", vers: "1.1.0", yanked: false, features: {} }),
            "",
        ].join("\n"));

        expect(metadata).toEqual({
            name: "tokio",
            versions: [
                { num: "1.0.0", yanked: true },
                { num: "1.1.0", yanked: false },
            ],
            homepage: null,
            repository: null,
        });
    });

    test("rejects partial or mismatched index data", () => {
        expect(() => parseCratesIndex("tokio", "not-json")).toThrow();
        expect(() => parseCratesIndex("tokio", "")).toThrow();
        expect(() => parseCratesIndex(
            "tokio",
            JSON.stringify({ name: "serde", vers: "1.0.0", yanked: false }))).toThrow();
    });
});

test("parseCratesApi keeps versions and rich links", () => {
    const metadata = parseCratesApi(JSON.stringify({
        crate: {
            name: "tokio",
            homepage: "https://tokio.rs",
            repository: "https://github.com/tokio-rs/tokio",
        },
        versions: [
            { num: "1.2.0", yanked: false },
            { num: "1.1.0" },
        ],
    }));

    expect(metadata).toEqual({
        name: "tokio",
        versions: [
            { num: "1.2.0", yanked: false },
            { num: "1.1.0", yanked: false },
        ],
        homepage: "https://tokio.rs",
        repository: "https://github.com/tokio-rs/tokio",
    });
});
