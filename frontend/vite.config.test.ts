import { describe, expect, test } from "bun:test";
import { classifyViteApiRequest } from "./vite.config";

describe("classifyViteApiRequest", () => {
    test("routes readiness GET to Vite", () => {
        expect(classifyViteApiRequest("GET", "/api/ready")).toBe("ready");
    });

    test("rejects unsupported readiness methods", () => {
        expect(classifyViteApiRequest("POST", "/api/ready")).toBe("method-not-allowed");
    });

    test("rejects Rust-owned data routes on direct Vite requests", () => {
        expect(classifyViteApiRequest("GET", "/api/data/rust")).toBe("not-found");
    });

    test("rejects unknown API routes", () => {
        expect(classifyViteApiRequest("GET", "/api/database")).toBe("not-found");
    });

    test("passes through API-like paths without a segment boundary", () => {
        expect(classifyViteApiRequest("GET", "/apiary")).toBe("passthrough");
    });

    test("passes through frontend content", () => {
        expect(classifyViteApiRequest("GET", "/src/index.ts")).toBe("passthrough");
    });
});
