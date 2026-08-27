import { describe, expect, test } from "bun:test";

import type { CrateData, RustCrateSourceContext } from "./index";
import { deleteCrate, RUST_CRATE_HOME_URL } from "./crate-delete";

/** Build a source context whose navigation requests can be asserted without
 * mounting Svelte or a WebView2 iframe. */
function createContext(currentUrl: string, crateNames: string[]) {
    const navigations: string[] = [];
    const crates = Object.fromEntries(crateNames.map(name => [
        name,
        { currentVersion: "latest", pinnedPages: [] } satisfies CrateData,
    ]));
    const ctx: RustCrateSourceContext = {
        data: { schemaVersion: 1, crates },
        currentUrl,
        navigateTo(url) { navigations.push(url); },
    };
    return { ctx, navigations };
}

describe("deleteCrate", () => {
    test("navigates home before deleting the viewed docs.rs crate", () => {
        const { ctx, navigations } = createContext(
            "https://docs.rs/tokio/latest/tokio/task/",
            ["tokio", "serde"]);

        deleteCrate(ctx, "tokio");

        expect(ctx.data.crates).toEqual({
            serde: { currentVersion: "latest", pinnedPages: [] },
        });
        expect(navigations).toEqual([RUST_CRATE_HOME_URL]);
    });

    test("recognizes the viewed crate through a docs.rs separator alias", () => {
        const { ctx, navigations } = createContext(
            "https://docs.rs/const_format/latest/const_format/",
            ["const-format"]);

        deleteCrate(ctx, "const-format");

        expect(ctx.data.crates).toEqual({});
        expect(navigations).toEqual([RUST_CRATE_HOME_URL]);
    });

    test("navigates from viewed standard-library documentation", () => {
        const { ctx, navigations } = createContext(
            "https://doc.rust-lang.org/std/vec/struct.Vec.html",
            ["std"]);

        deleteCrate(ctx, "std");

        expect(ctx.data.crates).toEqual({});
        expect(navigations).toEqual([RUST_CRATE_HOME_URL]);
    });

    test("preserves the current page when deleting another crate", () => {
        const { ctx, navigations } = createContext(
            "https://docs.rs/serde/latest/serde/",
            ["tokio", "serde"]);

        deleteCrate(ctx, "tokio");

        expect(ctx.data.crates).toEqual({
            serde: { currentVersion: "latest", pinnedPages: [] },
        });
        expect(navigations).toEqual([]);
    });

    test("does not reload the docs.rs home page", () => {
        const { ctx, navigations } = createContext(
            RUST_CRATE_HOME_URL,
            ["tokio"]);

        deleteCrate(ctx, "tokio");

        expect(ctx.data.crates).toEqual({});
        expect(navigations).toEqual([]);
    });
});
