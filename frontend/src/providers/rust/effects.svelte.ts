import { untrack } from "svelte";

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

    // (2) Current-URL sync. Track the URL and provider-data container, but
    // not nested mutations: deleting the viewed crate must not look like a
    // fresh navigation and immediately auto-import it again. Tracking the
    // container still reconciles persisted data after the async load.
    $effect(() => {
        const data = ctx.data;
        const currentUrl = ctx.currentUrl;
        untrack(() => handleCurrentUrl(ctx, data, currentUrl));
    });
}

/** Reconcile the current iframe URL with provider data:
 *  - Normalize the URL (re-navigate to the canonical form).
 *  - Adopt the canonical crate spelling from docs.rs redirects, merging any
 *    case or hyphen/underscore aliases already persisted in the workspace.
 *  - Update the matching crate's `currentVersion` if the URL pins a
 *    different one.
 *  - Auto-import unknown crates so cross-crate navigation feels seamless. */
function handleCurrentUrl(
    ctx: ProviderContext<RustProviderData>,
    data: RustProviderData,
    currentUrlText: string) {
    const currentUrl = parseUrl(currentUrlText);
    if (!currentUrl) return;

    if (currentUrlText !== buildUrl(currentUrl)) {
        // Canonical-form re-navigation always hits the proxy cache.
        ctx.navigateTo(buildUrl(currentUrl));
        return;
    }

    const crateName = currentUrl.name;
    data.crates ??= {};
    const crate = reconcileCrateName(data.crates, crateName);
    if (crate) {
        if (currentUrl.version !== crate.currentVersion) {
            crate.currentVersion = currentUrl.version;
        }
    } else {
        data.crates[crateName] = {
            currentVersion: currentUrl.version ?? "latest",
            pinnedPages: [],
        };
    }
}
