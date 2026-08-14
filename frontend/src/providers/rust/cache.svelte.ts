import {
    type CrateMetadata,
    getCratesApiUrl,
    getCratesIndexUrl,
    parseCratesApi,
    parseCratesIndex,
} from "./metadata";
import { getBaseUrlForCrate } from "./url";
import {
    CrateCacheLoader,
    CrateCacheResolver,
    type CrateCache,
    type CrateCacheEntry,
    type RustProviderCache,
} from "./cache-core";

export type { CrateCache, CrateCacheEntry, RustProviderCache };

/** Singleton `$state`-proxied cache. Reads inside any reactive context
 *  (`$derived`, `$effect`, component template) automatically register
 *  fine-grained dependencies; mutations propagate via Svelte's deep
 *  reactivity — no `useSyncExternalStore` bridge needed. */
export const crateCache: RustProviderCache = $state({ crates: {} });

const cacheLoader = new CrateCacheLoader(crateCache, fetchCrateMetadata);
const cacheResolver = new CrateCacheResolver(cacheLoader, resolveCrateMetadata);

/** Return cached metadata for one crate, or `null` for std-library crates
 *  (no crates.io entry) and crates whose fetch hasn't completed yet.
 *  This read never triggers network work. */
export function getCrateCache(crateName: string): CrateCache | null {
    if (getBaseUrlForCrate(crateName) === "https://doc.rust-lang.org/")
        return null;
    return cacheLoader.get(crateName)?.data ?? null;
}

/** Return the lazy request state for a crate without starting a request.
 * Missing entries are intentionally represented as idle without mutating
 * reactive state during provider rendering. */
export function getCrateCacheEntry(crateName: string): CrateCacheEntry {
    return cacheLoader.get(crateName) ?? {
        data: null,
        status: "idle",
        error: null,
    };
}

/** Resolve a user-entered docs.rs identifier through crates.io and populate
 * the selector cache under the canonical registry name. Failures reject so
 * the search UI can report them without persisting an invalid crate. */
export function resolveCrateCache(name: string): Promise<CrateCache> {
    return cacheResolver.resolve(name);
}

/** Lazily load sparse-index metadata for a docs.rs crate. Other Rust
 * documentation hosts have static or unsupported version selectors. */
export function ensureCrateCache(name: string): void {
    if (getBaseUrlForCrate(name) !== "https://docs.rs/") return;
    void cacheLoader.ensure(name);
}

/** Explicitly refresh crates.io metadata. Existing usable data remains in
 * place if the refresh fails. */
export function refreshCrateCache(name: string): void {
    void cacheLoader.refresh(name);
}

/** Fetch and parse one crate from the CDN-backed sparse index by default,
 * or from the real-time crates.io API for an explicit refresh. `no-store`
 * reaches the generic host proxy as a standard cache-bypass directive; the
 * proxy has no knowledge of either metadata format. */
async function fetchCrateMetadata(
    name: string,
    refresh: boolean): Promise<CrateMetadata> {
    const url = refresh ? getCratesApiUrl(name) : getCratesIndexUrl(name);
    const response = await fetch(url, refresh ? { cache: "no-store" } : undefined);
    if (!response.ok)
        throw new Error(`Crate metadata fetch failed for ${name}: ${response.status}`);
    const body = await response.text();
    return refresh ? parseCratesApi(body) : parseCratesIndex(name, body);
}

/** Fetch the authoritative crates.io record used to validate additions.
 * A missing crate has specific copy; other HTTP failures remain retryable and
 * retain their status code for troubleshooting. */
async function resolveCrateMetadata(name: string): Promise<CrateMetadata> {
    const response = await fetch(getCratesApiUrl(name));
    if (response.status === 404)
        throw new Error(`Crate "${name}" was not found.`);
    if (!response.ok)
        throw new Error(`Could not check crate "${name}": ${response.status}.`);
    return parseCratesApi(await response.text());
}
