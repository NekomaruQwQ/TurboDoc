import type { ProviderContext } from "@/core/data";

import type { RustProviderData } from "./index";
import { parseUrl, buildUrl, getBaseUrlForCrate } from "./url";
import {
    crateCache,
    getCrateCache,
    inFlight,
    batchFetchCrateCache,
} from "./cache.svelte";

/** Wire up the Rust provider's per-host effects. Called once during the
 *  ExplorerProvider component's init phase, so the `$effect` runes inside
 *  bind to that component's lifecycle.
 *
 *  Three concerns:
 *  1. Seed starter crates on a fresh install (so the sidebar isn't empty).
 *  2. Sync the iframe's current URL to provider data — auto-import unknown
 *     crates and update the active version when the URL pin changes.
 *  3. Batch-fetch metadata for any crate that lacks an in-memory cache
 *     entry. */
export function setupRustEffects(ctx: ProviderContext<RustProviderData>) {
    // (1) Seed starter crates. `hasCrates` reads `ctx.data.crates`, which
    // is the $state proxy — Svelte tracks the read and re-runs once the
    // user adds a crate (clearing the seed branch on subsequent flips).
    $effect(() => {
        const hasCrates = !!ctx.data.crates && Object.keys(ctx.data.crates).length > 0;
        if (!hasCrates) {
            ctx.data.crates = {
                serde: { currentVersion: "latest", pinnedPages: [] },
                tokio: { currentVersion: "latest", pinnedPages: [] },
            };
        }
    });

    // (2) Current-URL sync.
    $effect(() => {
        handleCurrentUrl(ctx);
    });

    // (3) Batch-fetch metadata for uncached crates. The `crateKeys` derived
    // string forces this to re-run only when the *set* of crate names
    // changes — additions and removals — not on every property mutation.
    $effect(() => {
        // Track via a stable key string so the effect doesn't fire on
        // unrelated mutations like `currentVersion` updates.
        const crateNames = Object.keys(ctx.data.crates ?? {});
        // Read into the dep graph: explicit access for tracking.
        void crateNames.join(",");

        const uncached = crateNames.filter(name =>
            !crateCache.crates[name]
            && !inFlight.has(name)
            && getBaseUrlForCrate(name) !== "https://doc.rust-lang.org/");
        if (uncached.length > 0) {
            for (const name of uncached) inFlight.add(name);
            void batchFetchCrateCache(uncached);
        }
    });
}

/** Reconcile the current iframe URL with provider data:
 *  - Normalize the URL (re-navigate to the canonical form).
 *  - Update the matching crate's `currentVersion` if the URL pins a
 *    different one.
 *  - Auto-import unknown crates so cross-crate navigation feels seamless. */
function handleCurrentUrl(ctx: ProviderContext<RustProviderData>) {
    const currentUrl = parseUrl(ctx.currentUrl);
    if (!currentUrl) return;

    if (ctx.currentUrl !== buildUrl(currentUrl)) {
        // Canonical-form re-navigation always hits the proxy cache.
        ctx.navigateTo(buildUrl(currentUrl));
        return;
    }

    const crateName = currentUrl.name;
    const crate = ctx.data.crates?.[crateName];
    if (crate) {
        if (currentUrl.version !== crate.currentVersion) {
            crate.currentVersion = currentUrl.version;
        }
    } else {
        ctx.data.crates ??= {};
        ctx.data.crates[crateName] = {
            currentVersion: currentUrl.version ?? "latest",
            pinnedPages: [],
        };
    }
}

// Re-export getCrateCache so call sites can tree-shake to a single import
// surface alongside the effect setup. Unused otherwise.
export { getCrateCache };
