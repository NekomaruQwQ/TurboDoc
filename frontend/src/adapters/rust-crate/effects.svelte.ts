import { untrack } from "svelte";

import type { RustCrateSourceContext, RustCrateSourceData } from "./index";
import { reconcileCrateName } from "./crate-name";
import { parseUrl, buildUrl } from "./url";

/** Wire current navigation into one ready Rust crate source.
 *
 * Starter crates are initialized only when the persistence endpoint reports a
 * genuinely missing file; keeping that decision out of a reactive effect means
 * an intentionally empty source stays empty.
 *
 *  Metadata loading is deliberately absent here. Version selectors request
 *  it only after the corresponding item receives user intent. */
export function setupRustCrateEffects(ctx: RustCrateSourceContext) {
    // Track the URL and source-data container, but
    // not nested mutations: deleting the viewed crate must not look like a
    // fresh navigation and immediately auto-import it again. Tracking the
    // container still reconciles persisted data after the async load.
    $effect(() => {
        const data = ctx.data;
        const currentUrl = ctx.currentUrl;
        untrack(() => handleCurrentUrl(ctx, data, currentUrl));
    });
}

/** Reconcile the current iframe URL with source data:
 *  - Normalize the URL (re-navigate to the canonical form).
 *  - Adopt the canonical crate spelling from docs.rs redirects, merging any
 *    case or hyphen/underscore aliases already persisted in the workspace.
 *  - Update the matching crate's `currentVersion` if the URL pins a
 *    different one.
 *  - Auto-import unknown crates so cross-crate navigation feels seamless. */
function handleCurrentUrl(
    ctx: RustCrateSourceContext,
    data: RustCrateSourceData,
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
