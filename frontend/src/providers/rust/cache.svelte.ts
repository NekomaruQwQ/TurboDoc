import * as Utils from "@/utils/version-group";

import {
    type CrateMetadata,
    getCratesApiUrl,
    getCratesIndexUrl,
    parseCratesApi,
    parseCratesIndex,
} from "./metadata";
import { getBaseUrlForCrate } from "./url";

/** Cached metadata for a single crate. The frontend owns the upstream
 * formats; the host only provides transparent HTTP caching. */
export interface CrateCache {
    name: string;
    versions: { num: string; yanked: boolean }[];
    versionGroups: { versions: { num: string; yanked: boolean }[] }[];
    homepage: string | null;
    repository: string | null;
}

/** In-memory shape of the Rust provider's metadata store. */
export interface RustProviderCache {
    crates: Record<string, CrateCache>;
}

/** Singleton `$state`-proxied cache. Reads inside any reactive context
 *  (`$derived`, `$effect`, component template) automatically register
 *  fine-grained dependencies; mutations propagate via Svelte's deep
 *  reactivity — no `useSyncExternalStore` bridge needed. */
export const crateCache: RustProviderCache = $state({ crates: {} });

/** Crate names currently being fetched; prevents duplicate requests when
 *  the host effect fires multiple times before a response lands. */
export const inFlight = new Set<string>();

/** Return cached metadata for one crate, or `null` for std-library crates
 *  (no crates.io entry) and crates whose fetch hasn't completed yet.
 *  Does not trigger fetches — that's the host's responsibility. */
export function getCrateCache(crateName: string): CrateCache | null {
    if (getBaseUrlForCrate(crateName) === "https://doc.rust-lang.org/")
        return null;
    return crateCache.crates[crateName] ?? null;
}

/** Evict a single crate from the cache. Used by the "Refresh Metadata"
 *  action so the next render shows a stale-data placeholder until the
 *  fresh fetch lands. */
export function deleteCrateCache(name: string) {
    delete crateCache.crates[name];
}

function crateMetadataToCache(meta: CrateMetadata): CrateCache {
    return {
        name: meta.name,
        versions: meta.versions,
        versionGroups: Utils.computeVersionGroups(meta.versions),
        repository: meta.repository,
        homepage: meta.homepage,
    };
}

/** Fetch and parse one crate from the CDN-backed sparse index by default,
 * or from the real-time crates.io API for an explicit refresh. `no-store`
 * reaches the generic host proxy as a standard cache-bypass directive; the
 * proxy has no knowledge of either metadata format. */
async function fetchCrateMetadata(name: string, refresh: boolean): Promise<CrateMetadata> {
    const url = refresh ? getCratesApiUrl(name) : getCratesIndexUrl(name);
    const response = await fetch(url, refresh ? { cache: "no-store" } : undefined);
    if (!response.ok)
        throw new Error(`Crate metadata fetch failed for ${name}: ${response.status}`);
    const body = await response.text();
    return refresh ? parseCratesApi(body) : parseCratesIndex(name, body);
}

/** Fetch metadata for several crates concurrently and populate the in-memory
 * cache as each result arrives. Individual failures are non-fatal and do not
 * discard successful siblings. The `inFlight` guard is always cleared so a
 * failed request cannot permanently block a later attempt. */
export async function batchFetchCrateCache(
    names: string[],
    refresh?: boolean,
): Promise<void> {
    console.log(`[crates] Fetching metadata for ${names.length} crate(s)${refresh ? " (refresh)" : ""}.`);
    for (const name of names) inFlight.add(name);
    try {
        await Promise.all(names.map(async name => {
            try {
                const metadata = await fetchCrateMetadata(name, refresh ?? false);
                crateCache.crates[name] = crateMetadataToCache(metadata);
            } catch (error) {
                console.error(`Failed to fetch crate metadata for ${name}:`, error);
            }
        }));
    } finally {
        for (const name of names) inFlight.delete(name);
    }
}
