// Dedicated SQLite cache for crates.io API responses.
//
// Stores raw upstream response bodies with a simple time-based TTL.
// No LRU eviction — crate metadata is small (~10-50 KB per entry)
// and bounded by the number of crates the user tracks.
//
// On upstream failure, stale entries are served rather than returning
// null — crate metadata doesn't change retroactively, so stale data
// is better than no data.

import { dbCache } from "@server/common";

// -- Configuration --------------------------------------------------------

/** Time-to-live for cached crate metadata, in seconds.
 *  24 hours — crate metadata (versions, description, links) changes
 *  infrequently, and version publishes aren't time-critical for a
 *  documentation viewer. */
const MAX_AGE_SECONDS = 86400;

/** User-Agent for crates.io API requests.
 *  Required by crates.io crawler policy (https://crates.io/policies). */
const USER_AGENT = "TurboDoc/0.3 (documentation viewer)";

// -- Types ----------------------------------------------------------------

/** Normalized crate metadata returned by `POST /crates`. Flattened from the
 *  nested crates.io API response shape — the frontend never sees the raw
 *  upstream format. */
export interface CrateMetadata {
    name: string;
    description: string | null;
    homepage: string | null;
    repository: string | null;
    documentation: string | null;
    versions: { num: string; yanked: boolean }[];
}

/** A cached crate entry: the raw response body and a freshness flag. */
export interface CachedCrate {
    body: Buffer;
    fresh: boolean;
}

// -- Table creation -------------------------------------------------------

dbCache.run(`CREATE TABLE IF NOT EXISTS crates_cache (
    name       TEXT PRIMARY KEY,
    body       BLOB NOT NULL,
    fetched_at INTEGER NOT NULL
)`);

// -- Prepared statements --------------------------------------------------

const stmtGet =
    dbCache.prepare("SELECT body, fetched_at FROM crates_cache WHERE name = ?");
const stmtUpsert =
    dbCache.prepare(`INSERT OR REPLACE INTO crates_cache (name, body, fetched_at)
    VALUES (?1, ?2, ?3)`);

/** Row shape returned by SQLite queries. */
interface CratesCacheRecord {
    body: Uint8Array;
    fetched_at: number;
}

// -- Public API -----------------------------------------------------------

/** Parse a raw crates.io API response body into `CrateMetadata`.
 *  Returns `null` if the body is malformed or missing required fields. */
export function parseCrateMetadata(
    name: string, body: Buffer,
): CrateMetadata | null {
    try {
        const data = JSON.parse(body.toString("utf-8"));
        const crate = data?.crate;
        const versions = data?.versions;
        if (!crate?.name || !Array.isArray(versions)) return null;

        return {
            name: crate.name,
            description: crate.description ?? null,
            homepage: crate.homepage ?? null,
            repository: crate.repository ?? null,
            documentation: crate.documentation ?? null,
            versions: versions
                .filter((v: any) => typeof v?.num === "string")
                .map((v: any) => ({
                    num: v.num as string,
                    yanked: v.yanked === true,
                })),
        };
    } catch {
        console.error(`[crates] Failed to parse metadata for ${name}.`);
        return null;
    }
}

/** Look up a cached crate response. Returns the raw body and whether it's
 *  still within TTL. Stale entries are still returned — the caller decides
 *  whether to refresh or use the fallback. Returns `null` on cache miss. */
export function get(name: string): CachedCrate | null {
    const row = stmtGet.get(name) as CratesCacheRecord | null;
    if (!row) return null;

    const now = Math.floor(Date.now() / 1000);
    const age = now - row.fetched_at;
    return {
        // bun:sqlite returns BLOB as Uint8Array — wrap to Buffer so
        // downstream code can use Buffer.toString("utf-8") correctly.
        body: Buffer.from(row.body),
        fresh: age < MAX_AGE_SECONDS,
    };
}

/** Store a raw crates.io API response body. Overwrites any existing entry. */
export function set(name: string, body: Buffer): void {
    const now = Math.floor(Date.now() / 1000);
    stmtUpsert.run(name, body, now);
}

/** Fetch a crate's metadata from crates.io upstream.
 *  Returns the raw response body on success (HTTP 200), or `null` on
 *  non-200 responses. Throws on network errors — the caller should
 *  catch and fall back to stale cache entries. */
export async function fetchUpstream(name: string): Promise<Buffer | null> {
    const url = `https://crates.io/api/v1/crates/${name}`;
    const response = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
}
