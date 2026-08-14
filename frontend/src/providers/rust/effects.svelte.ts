import type { ProviderContext } from "@/core/data";

import type { RustProviderData } from "./index";
import { reconcileCrateName } from "./crate-name";
import { parseUrl, buildUrl } from "./url";

/** Wire up the Rust provider's per-host effects. Called once during the
 *  ExplorerProvider component's init phase, so the `$effect` runes inside
 *  bind to that component's lifecycle.
 *
 *  Two concerns:
 *  1. Seed starter crates on a fresh install (so the sidebar isn't empty).
 *  2. Sync the iframe's current URL to provider data — auto-import unknown
 *     crates and update the active version when the URL pin changes.
 *
 *  Metadata loading is deliberately absent here. Version selectors request
 *  it only after the corresponding item receives user intent. */
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
}

/** Reconcile the current iframe URL with provider data:
 *  - Normalize the URL (re-navigate to the canonical form).
 *  - Adopt the canonical crate spelling from docs.rs redirects, merging any
 *    case or hyphen/underscore aliases already persisted in the workspace.
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
    ctx.data.crates ??= {};
    const crate = reconcileCrateName(ctx.data.crates, crateName);
    if (crate) {
        if (currentUrl.version !== crate.currentVersion) {
            crate.currentVersion = currentUrl.version;
        }
    } else {
        ctx.data.crates[crateName] = {
            currentVersion: currentUrl.version ?? "latest",
            pinnedPages: [],
        };
    }
}
