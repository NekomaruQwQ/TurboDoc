import { describe, expect, test } from "bun:test";

import { apiResourceUrl } from "./api";

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
});
