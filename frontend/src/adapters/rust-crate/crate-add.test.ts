import { describe, expect, test } from "bun:test";

import type { RustCrateSourceContext } from "./index";
import { addCrate } from "./crate-add";

/** Build a minimal source context that records every requested navigation. */
function createContext(): {
    ctx: RustCrateSourceContext;
    navigations: string[];
} {
    const navigations: string[] = [];
    return {
        ctx: {
            data: { schemaVersion: 1, crates: {} },
            currentUrl: "",
            navigateTo: url => navigations.push(url),
        },
        navigations,
    };
}

describe("addCrate", () => {
    test("persists the canonical name before navigating exactly once", async () => {
        const { ctx, navigations } = createContext();
        const events: string[] = [];

        await addCrate(
            ctx,
            "async_std",
            async requestedName => {
                events.push(`resolve:${requestedName}`);
                return { name: "async-std" };
            },
            async () => {
                expect(ctx.data.crates["async-std"]).toBeDefined();
                expect(ctx.data.crates.async_std).toBeUndefined();
                events.push("render");
            });

        expect(events).toEqual(["resolve:async_std", "render"]);
        expect(navigations).toEqual([
            "https://docs.rs/async-std/latest/async_std/",
        ]);
    });

    test("uses an underscore canonical name for a hyphenated alias", async () => {
        const { ctx, navigations } = createContext();

        await addCrate(
            ctx,
            "const-format",
            async () => ({ name: "const_format" }),
            async () => {});

        expect(ctx.data.crates.const_format).toBeDefined();
        expect(ctx.data.crates["const-format"]).toBeUndefined();
        expect(navigations).toEqual([
            "https://docs.rs/const_format/latest/const_format/",
        ]);
    });

    test("does not mutate or navigate when registry resolution fails", async () => {
        const { ctx, navigations } = createContext();

        await expect(addCrate(
            ctx,
            "async_syd",
            async () => { throw new Error("Crate not found"); },
            async () => {})).rejects.toThrow("Crate not found");

        expect(ctx.data.crates).toEqual({});
        expect(navigations).toEqual([]);
    });

    test("keeps known standard-library crates independent of crates.io", async () => {
        const { ctx, navigations } = createContext();
        let resolutionCalls = 0;

        await addCrate(
            ctx,
            "std",
            async () => {
                resolutionCalls += 1;
                return { name: "std" };
            },
            async () => {});

        expect(resolutionCalls).toBe(0);
        expect(ctx.data.crates.std?.currentVersion).toBe("stable");
        expect(navigations).toEqual([
            "https://doc.rust-lang.org/std/",
        ]);
    });
});
