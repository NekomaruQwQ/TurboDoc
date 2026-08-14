import { describe, expect, test } from "bun:test";

import { crateNamesEquivalent, reconcileCrateName } from "./crate-name";

/** Build a minimal persisted crate record for reconciliation tests. */
function crate(currentVersion: string, pinnedPages: string[] = []) {
    return { currentVersion, pinnedPages };
}

/** Mutable name-keyed fixture matching the provider's persisted shape. */
type TestCrates = Record<string, ReturnType<typeof crate>>;

describe("crateNamesEquivalent", () => {
    test("accepts case and separator aliases", () => {
        expect(crateNamesEquivalent("Const-Format", "const_format")).toBeTrue();
    });

    test("rejects different crate names", () => {
        expect(crateNamesEquivalent("serde", "serde_json")).toBeFalse();
    });
});

describe("reconcileCrateName", () => {
    test("uses the canonical underscore spelling reported by docs.rs", () => {
        const crates: TestCrates = {
            "const-format": crate("latest", ["const_format/macro.formatcp.html"]),
        };

        reconcileCrateName(crates, "const_format");

        expect(crates).toEqual({
            const_format: crate("latest", ["const_format/macro.formatcp.html"]),
        });
    });

    test("uses the canonical hyphen spelling reported by docs.rs", () => {
        const crates: TestCrates = { async_std: crate("1.13.2") };

        reconcileCrateName(crates, "async-std");

        expect(crates).toEqual({ "async-std": crate("1.13.2") });
    });

    test("merges aliases into an existing canonical crate without losing pins", () => {
        const crates: TestCrates = {
            const_format: crate("0.2.36", ["const_format/index.html"]),
            "const-format": crate("latest", ["const_format/macro.formatcp.html"]),
        };

        reconcileCrateName(crates, "const_format");

        expect(crates).toEqual({
            const_format: crate("0.2.36", [
                "const_format/index.html",
                "const_format/macro.formatcp.html",
            ]),
        });
    });

    test("leaves unrelated crates untouched when no equivalent exists", () => {
        const crates: TestCrates = { tokio: crate("latest") };

        const result = reconcileCrateName(crates, "serde");

        expect({ crates, result }).toEqual({
            crates: { tokio: crate("latest") },
            result: undefined,
        });
    });
});
