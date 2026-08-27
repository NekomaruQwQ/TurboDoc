import type { CrateCache } from "./cache-core";
import type { CrateData, RustCrateSourceContext } from "./index";
import { buildUrl, getBaseUrlForCrate } from "./url";

/** Resolve a crates.io identifier to the canonical cache record returned by
 * the registry. Rejections are surfaced by the Explorer before persistence. */
export type ResolveCrateCache =
    (requestedName: string) => Promise<Pick<CrateCache, "name">>;

/** Wait until Svelte has rendered a newly persisted crate card. */
export type WaitForCrateRender = () => Promise<void>;

/** Resolve, persist, render, and navigate to one crate as a single ordered
 * transaction. crates.io is the authority for docs.rs names, while built-in
 * documentation hosts keep their known local identifiers.
 *
 * Resolution failures propagate without mutating source state or starting
 * navigation. Waiting for the render before the sole navigation ensures the
 * Explorer can reveal the new canonical item when navigation is reported. */
export async function addCrate(
    ctx: RustCrateSourceContext,
    requestedName: string,
    resolveCrateCache: ResolveCrateCache,
    waitForRender: WaitForCrateRender): Promise<void> {
    const canonicalName = getBaseUrlForCrate(requestedName) === "https://docs.rs/"
        ? (await resolveCrateCache(requestedName)).name
        : requestedName;

    ensureCrate(ctx, canonicalName);
    await waitForRender();
    navigateToCrateRoot(ctx, canonicalName);
}

/** Return the existing crate or add its minimal lazy-metadata record. Standard
 * library crates start on stable; every other source retains the established
 * latest alias and performs no metadata request. */
export function ensureCrate(
    ctx: RustCrateSourceContext,
    crateName: string): CrateData {
    ctx.data.crates ??= {};
    return ctx.data.crates[crateName] ??= {
        currentVersion:
            getBaseUrlForCrate(crateName) === "https://doc.rust-lang.org/"
                ? "stable"
                : "latest",
        pinnedPages: [],
    };
}

/** Navigate to a crate's root module using its persisted version. A stale
 * combobox result can outlive deletion, so a missing record is a safe no-op. */
export function navigateToCrateRoot(
    ctx: RustCrateSourceContext,
    crateName: string): void {
    const crate = ctx.data.crates?.[crateName];
    if (!crate) return;
    ctx.navigateTo(buildUrl({
        baseUrl: getBaseUrlForCrate(crateName),
        name: crateName,
        version: crate.currentVersion,
        pathSegments: [crateName.replaceAll("-", "_")],
    }));
}
