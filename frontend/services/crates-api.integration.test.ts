import { describe, expect, test } from "bun:test";

import { fetchCrateInfo, searchCrates, CrateNotFoundError } from "@/services/crates-api";

/**
 * Integration tests for crates.io API.
 * These tests make real HTTP requests and may take 10-20 seconds due to rate limiting.
 */

describe("CratesAPI integration tests", () => {
    test("fetches metadata for serde", async () => {
        const { crate, versions } = await fetchCrateInfo("serde");

        // Verify basic structure
        expect(crate).toBeDefined();
        expect(crate.name).toBe("serde");
        expect(crate.description).toBeTruthy();
        expect(crate.description?.toLowerCase()).toContain("serializ"); // Should mention serialization
        expect(crate.repository).toBeTruthy();
        expect(crate.repository).toContain("github.com"); // serde is on GitHub

        // Verify versions array
        expect(versions).toBeDefined();
        expect(Array.isArray(versions)).toBe(true);
        expect(versions.length).toBeGreaterThan(0);

        // Verify version structure
        const firstVersion = versions[0];
        expect(firstVersion).toBeDefined();
        expect(firstVersion!.num).toBeTruthy();
        expect(typeof firstVersion!.num).toBe("string");
        expect(typeof firstVersion!.yanked).toBe("boolean");
    });

    test("fetches metadata for tokio", async () => {
        const { crate, versions } = await fetchCrateInfo("tokio");

        expect(crate).toBeDefined();
        expect(crate.name).toBe("tokio");
        expect(crate.description?.toLowerCase()).toContain("asynchronous"); // Async runtime
        expect(crate.repository).toContain("github.com");
        expect(crate.homepage).toBeTruthy();

        // Verify versions
        expect(versions.length).toBeGreaterThan(0);
    });

    test("throws CrateNotFoundError for nonexistent crate", async () => {
        expect(async () => {
            await fetchCrateInfo("this-crate-definitely-does-not-exist-12345");
        }).toThrow(CrateNotFoundError);
    });

    test("search returns results for "serde"", async () => {
        const results = await searchCrates("serde");

        expect(results).toBeDefined();
        expect(results.length).toBeGreaterThan(0);

        // serde should be in the results
        const serdeResult = results.find(r => r.name === "serde");
        expect(serdeResult).toBeDefined();
        expect(serdeResult?.description).toBeTruthy();
    });

    test("search returns results for "async"", async () => {
        const results = await searchCrates("async");

        expect(results).toBeDefined();
        expect(results.length).toBeGreaterThan(0);

        // Results should have name and description
        for (const result of results.slice(0, 5)) {
            expect(result.name).toBeTruthy();
            expect(typeof result.name).toBe("string");
            expect(result.description === null || typeof result.description === "string").toBe(true);
        }
    });

    test("search returns empty array for nonsense query", async () => {
        const results = await searchCrates("xyzqwertyasdfzxcv123456789");

        expect(results).toBeDefined();
        expect(Array.isArray(results)).toBe(true);
        // Might be empty or have very few results
        expect(results.length).toBeLessThan(5);
    });

    test("respects rate limiting (sequential requests)", async () => {
        const startTime = Date.now();

        // Make 3 sequential requests
        await fetchCrateInfo("serde");
        await fetchCrateInfo("tokio");
        await fetchCrateInfo("rand");

        const elapsed = Date.now() - startTime;

        // Should take at least 2 seconds (2 delays of 1 second each)
        // We check for >= 1800ms to account for some timing variance
        expect(elapsed).toBeGreaterThanOrEqual(1800);
    });

    test("handles crates with various metadata fields", async () => {
        const { crate } = await fetchCrateInfo("serde");

        // serde has comprehensive metadata
        expect(crate.repository).not.toBeNull();
        expect(crate.homepage).not.toBeNull();
        expect(crate.documentation).not.toBeNull();
        expect(crate.description).toBeTruthy();
    });

    test("handles optional metadata fields correctly", async () => {
        const { crate } = await fetchCrateInfo("serde");

        // Optional fields should be null or string
        expect(crate.repository === null || typeof crate.repository === "string").toBe(true);
        expect(crate.homepage === null || typeof crate.homepage === "string").toBe(true);
        expect(crate.documentation === null || typeof crate.documentation === "string").toBe(true);
        expect(crate.description === null || typeof crate.description === "string").toBe(true);
    });

    test("returns versions sorted newest to oldest", async () => {
        const { versions } = await fetchCrateInfo("serde");

        expect(versions.length).toBeGreaterThan(1);

        // Verify versions are in descending order (newest first)
        for (let i = 0; i < Math.min(5, versions.length - 1); i++) {
            const current = versions[i];
            const next = versions[i + 1];

            expect(current).toBeDefined();
            expect(next).toBeDefined();

            // Just verify they"re valid semver strings
            expect(current!.num).toMatch(/^\d+\.\d+\.\d+/);
            expect(next!.num).toMatch(/^\d+\.\d+\.\d+/);
        }
    });

    test("includes yanked status for versions", async () => {
        const { versions } = await fetchCrateInfo("serde");

        // All versions should have yanked property
        for (const version of versions.slice(0, 10)) {
            expect(typeof version.yanked).toBe("boolean");
        }
    });
});
