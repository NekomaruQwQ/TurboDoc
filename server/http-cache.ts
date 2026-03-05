// SQLite-backed HTTP cache with LRU eviction.
//
// Uses `bun:sqlite` (built-in, zero dependency) for storage and
// `http-cache-semantics` for RFC 7234 cache policy evaluation.
//
// The cache stores clean upstream responses — code injection is
// applied at serve time by the proxy route.

import { dbCache } from "@server/common";

// == HTTP Cache ==
/** Maximum number of cached responses. When the cache is full, the least
 *  recently accessed entry is evicted before inserting a new one. */
import HttpCachePolicy from "http-cache-semantics";

const MAX_HTTP_CACHE_ENTRIES = 2000;

/** A cached HTTP response with its associated cache policy. */
export interface CacheEntry {
    /** Cache policy for the response, used to determine freshness and staleness. */
    policy: HttpCachePolicy;
    /** HTTP status code of the response. */
    statusCode: number;
    /** Content-Type header of the response. Empty string if not present. */
    contentType: string;
    /** Redirect target URL. Empty string for non-redirect responses. */
    location: string;
    /** Response body. Null for redirect responses. */
    body: Buffer | null;
}

/** Row shape returned by SQLite queries. */
interface CacheRecord {
    url: string;
    policy: string;
    status_code: number;
    content_type: string;
    location: string;
    body: Uint8Array | null;
    last_accessed: number;
    last_fetched: number;
}

/** Mapping of HttpCacheRecord fields to SQLite column types. Used for table creation. */
const httpCacheSchema = {
    url: "TEXT PRIMARY KEY",
    policy: "TEXT PRIMARY KEY",
    status_code: "INTEGER NOT NULL",
    content_type: "TEXT NOT NULL DEFAULT ''",
    location: "TEXT NOT NULL DEFAULT ''",
    body: "BLOB",
    last_accessed: "INTEGER NOT NULL",
    last_fetched: "INTEGER NOT NULL",
} as const satisfies Record<keyof CacheRecord, string>;

dbCache.run(`CREATE TABLE IF NOT EXISTS http_cache (${
    Object
        .entries(httpCacheSchema)
        .map(([field, type]) => `${field} ${type}`)
        .join(", ")
})`);

// Prepared statements, created once for performance.
const stmtGet =
    dbCache.prepare("SELECT * FROM http_cache WHERE url = ?");
const stmtTouch =
    dbCache.prepare("UPDATE http_cache SET last_accessed = ?2 WHERE url = ?1");
const stmtUpsert =
    dbCache.prepare(`INSERT OR REPLACE INTO http_cache
        (url, policy, status_code, content_type, location, body, last_accessed, last_fetched)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
`);
const stmtCount =
    dbCache.prepare("SELECT COUNT(*) as count FROM http_cache");
const stmtEvict =
    dbCache.prepare("DELETE FROM http_cache WHERE url = (SELECT url FROM http_cache ORDER BY last_accessed ASC LIMIT 1)");
const stmtDelete =
    dbCache.prepare("DELETE FROM http_cache WHERE url = ?");

/** Number of entries currently in the cache. */
export function getHttpCacheCount(): number {
    const { count } = stmtCount.get() as { count: number };
    return count;
}

/**
 * Look up a cached response by URL. Returns null on miss.
 * On hit, updates `last_accessed` for LRU tracking.
 */
export function get(url: string): CacheEntry | null {
    const row = stmtGet.get(url) as CacheRecord | null;
    if (!row) return null;

    const now = Math.floor(Date.now() / 1000);
    stmtTouch.run(url, now);

    return {
        policy: HttpCachePolicy.fromObject(JSON.parse(row.policy)),
        statusCode: row.status_code,
        contentType: row.content_type,
        location: row.location,
        // bun:sqlite returns BLOB as Uint8Array, not Buffer. Wrap it so
        // downstream code can use Buffer.toString("utf-8") correctly —
        // Uint8Array.toString() ignores the encoding and returns
        // comma-separated byte values instead.
        body: row.body ? Buffer.from(row.body) : null,
    };
}

/**
 * Store a response in the cache. If the cache is at capacity, the least
 * recently accessed entry is evicted first.
 *
 * If an entry with the same URL already exists, it is replaced (upsert).
 */
export function set(url: string, entry: CacheEntry): void {
    // Evict LRU entry if at capacity (only when inserting a genuinely new URL).
    const existing = stmtGet.get(url) as CacheRecord | null;
    if (!existing) {
        const { count } = stmtCount.get() as { count: number };
        if (count >= MAX_HTTP_CACHE_ENTRIES) {
            stmtEvict.run();
        }
    }

    const now = Math.floor(Date.now() / 1000);
    stmtUpsert.run(
        url,
        JSON.stringify(entry.policy.toObject()),
        entry.statusCode,
        entry.contentType,
        entry.location,
        entry.body,
        now,
        existing ? (existing.last_fetched) : now);
}

/** Delete a cache entry by URL. No-op if the entry doesn't exist. */
export function remove(url: string): void {
    stmtDelete.run(url);
}
