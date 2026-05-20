import * as Utils from "@/utils/version-group";

import { getBaseUrlForCrate } from "./url";

/** Normalized crate metadata returned by the server's `POST /api/v1/crates`.
 *  Mirrors the shape produced by `src/server/crates_cache.rs::CrateMetadata`. */
export interface CrateMetadata {
    name: string;
    description: string | null;
    homepage: string | null;
    repository: string | null;
    documentation: string | null;
    versions: { num: string; yanked: boolean }[];
}

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

/** Server response shape. `results` is what was in cache (fresh or stale);
 *  `pending` is what's being warmed in the background and isn't ready yet.
 *  See `src/server/api/crates.rs`. */
interface CratesResponse {
    results: Record<string, CrateMetadata | null>;
    pending: string[];
}

async function fetchCratesMetadata(
    names: string[],
    refresh?: boolean,
): Promise<CratesResponse> {
    const url = refresh ? "/api/v1/crates?refresh=true" : "/api/v1/crates";
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
    });
    if (!response.ok)
        throw new Error(`Batch crate fetch failed: ${response.status}`);
    return await response.json() as CratesResponse;
}

// Retry budget for `pending` crates while the host's cache-warming tasks
// run upstream fetches. Caps total wait at roughly 30s, which is the same
// timeout `frontend::spawn_vite` uses elsewhere — long enough to absorb a
// cold-network batch import, short enough to surface a real problem.
const MAX_ATTEMPTS = 8;
const INITIAL_DELAY_MS = 500;
const MAX_DELAY_MS = 4000;

/** Fetch metadata for the given crates from the host in one batch and
 *  populate the in-memory cache. The host returns immediately with
 *  whatever's already cached and a `pending` list for crates being
 *  warmed in the background; this function polls with exponential
 *  backoff until everything resolves (or the retry budget is spent).
 *
 *  Errors are logged but non-fatal; the `inFlight` guard is always
 *  cleared in the `finally` block so a failed batch doesn't permanently
 *  block re-fetching. */
export async function batchFetchCrateCache(
    names: string[],
    refresh?: boolean,
): Promise<void> {
    console.log(`[crates] Fetching metadata for ${names.length} crate(s)${refresh ? " (refresh)" : ""}.`);
    const originalNames = [...names];
    try {
        let pending = [...names];
        let delay = INITIAL_DELAY_MS;
        for (let attempt = 0; attempt < MAX_ATTEMPTS && pending.length > 0; attempt++) {
            if (attempt > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
                delay = Math.min(delay * 2, MAX_DELAY_MS);
                console.log(`[crates] retry ${attempt}/${MAX_ATTEMPTS - 1} for ${pending.length} pending crate(s)`);
            }
            const response = await fetchCratesMetadata(pending, refresh);
            // `refresh` only matters on the first attempt; subsequent
            // retries are just polling the cache. Sending refresh=true on
            // every retry would re-trigger upstream fetches needlessly
            // (deduped server-side, but still wasteful).
            refresh = false;

            const entries: Record<string, CrateCache> = {};
            for (const [name, meta] of Object.entries(response.results)) {
                if (meta) entries[name] = crateMetadataToCache(meta);
            }
            if (Object.keys(entries).length > 0)
                setCrateCaches(entries);

            pending = response.pending;
        }
        if (pending.length > 0)
            console.warn(`[crates] gave up after ${MAX_ATTEMPTS} attempts; still pending: ${pending.join(", ")}`);
    } catch (err) {
        console.error("Batch crate fetch failed:", err);
    } finally {
        for (const name of originalNames) inFlight.delete(name);
    }
}
