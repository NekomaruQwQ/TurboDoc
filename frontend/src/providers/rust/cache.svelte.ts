import type { CrateMetadata } from "@/server/api";
import * as Utils from "@/utils/version-group";

import { getBaseUrlForCrate } from "./url";

/** Cached metadata for a single crate, fetched from crates.io API via the
 *  HTTP proxy. Stored in-memory only — the proxy's SQLite cache handles
 *  persistence and freshness. */
export interface CrateCache {
    name: string;
    versions: { num: string; yanked: boolean }[];
    versionGroups: { versions: { num: string; yanked: boolean }[] }[];
    homepage: string | null;
    repository: string | null;
    documentation: string | null;
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

export function setCrateCaches(entries: Record<string, CrateCache>) {
    Object.assign(crateCache.crates, entries);
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
        documentation: meta.documentation,
    };
}

async function fetchCratesMetadata(
    names: string[],
    refresh?: boolean,
): Promise<Record<string, CrateMetadata | null>> {
    console.log(`[crates] Fetching metadata for ${names.length} crate(s)${refresh ? " (refresh)" : ""}.`);
    const url = refresh ? "/api/v1/crates?refresh=true" : "/api/v1/crates";
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
    });
    if (!response.ok)
        throw new Error(`Batch crate fetch failed: ${response.status}`);
    return await response.json() as Record<string, CrateMetadata | null>;
}

/** Fetch metadata for the given crates from the server in one batch and
 *  populate the in-memory cache. Errors are logged but non-fatal; the
 *  `inFlight` guard is always cleared in the `finally` block. */
export async function batchFetchCrateCache(
    names: string[],
    refresh?: boolean,
): Promise<void> {
    try {
        const results = await fetchCratesMetadata(names, refresh);
        const entries: Record<string, CrateCache> = {};
        for (const [name, meta] of Object.entries(results)) {
            if (meta) entries[name] = crateMetadataToCache(meta);
        }
        if (Object.keys(entries).length > 0)
            setCrateCaches(entries);
    } catch (err) {
        console.error("Batch crate fetch failed:", err);
    } finally {
        for (const name of names) inFlight.delete(name);
    }
}
