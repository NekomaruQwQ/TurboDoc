import { describe, expect, test } from "bun:test";

import { createItemKey, parseItemKey } from "./itemKey";

describe("composite Explorer item keys", () => {
    test("round-trips punctuation without separator ambiguity", () => {
        const key = createItemKey("rust-crates", "crate:with/a%path");

        expect(parseItemKey(key)).toEqual({
            sourceId: "rust-crates",
            localItemId: "crate:with/a%path",
        });
    });

    test("rejects non-canonical and malformed keys", () => {
        expect([
            parseItemKey("rust-crates:crate:extra"),
            parseItemKey("rust-crates:%"),
            parseItemKey(":crate"),
        ]).toEqual([null, null, null]);
    });

    test("never brands an empty identity component", () => {
        expect(() => createItemKey("", "item")).toThrow("nonempty");
        expect(() => createItemKey("source", "")).toThrow("nonempty");
    });
});
