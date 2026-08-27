import { describe, expect, test } from "bun:test";

import { apiResourceUrl, parseResourceExistsHeader } from "./api";

describe("apiResourceUrl", () => {
    test("uses the unmapped API origin for release artifacts", () => {
        expect(apiResourceUrl(
            "/api/data/rust",
            "https://turbodoc.example",
        )).toBe("https://api.turbodoc.example/api/data/rust");
    });

    test("keeps development API requests relative to the Vite origin", () => {
        expect(apiResourceUrl(
            "/api/data/rust",
            "http://127.0.0.1:5173",
        )).toBe("/api/data/rust");
    });

    test("maps per-source resources through the same release API boundary", () => {
        expect(apiResourceUrl(
            "/api/sources/rust-crates",
            "https://turbodoc.example",
        )).toBe("https://api.turbodoc.example/api/sources/rust-crates");
    });
});

describe("parseResourceExistsHeader", () => {
    test("requires an explicit true or false value", () => {
        expect(parseResourceExistsHeader("true")).toBe(true);
        expect(parseResourceExistsHeader("false")).toBe(false);
        expect(() => parseResourceExistsHeader(null)).toThrow("invalid");
        expect(() => parseResourceExistsHeader("TRUE")).toThrow("invalid");
    });
});
