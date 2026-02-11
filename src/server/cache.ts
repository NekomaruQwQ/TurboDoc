// SQLite-backed HTTP cache with LRU eviction.
//
// Uses `bun:sqlite` (built-in, zero dependency) for storage and
// `http-cache-semantics` for RFC 7234 cache policy evaluation.
//
// The cache stores clean upstream responses — dark mode injection is applied
// at serve time by the proxy route, not here.

import { Database } from "bun:sqlite";
import CachePolicy from "http-cache-semantics";

/// Maximum number of cached responses. When the cache is full, the least
/// recently accessed entry is evicted before inserting a new one.
const MAX_CACHE_ENTRIES = 2000;

// == Types ==

/** A cached HTTP response with its associated cache policy. */
export interface CacheEntry {
    policy: CachePolicy;
    statusCode: number;
    contentType: string;
    /** Redirect target URL. Empty string for non-redirect responses. */
    location: string;
    /** Response body. Null for redirect responses. */
    body: Buffer | null;
}

/** Row shape returned by SQLite queries. */
interface CacheRow {
    url: string;
    policy: string;
    status_code: number;
    content_type: string;
    location: string;
    body: Buffer | null;
    last_accessed_at: number;
    cached_at: number;
}

// == HttpCache ==

export class HttpCache {
    private db: Database;

    // Prepared statements, created once for performance.
    private stmtGet: ReturnType<Database["prepare"]>;
    private stmtTouch: ReturnType<Database["prepare"]>;
    private stmtUpsert: ReturnType<Database["prepare"]>;
    private stmtCount: ReturnType<Database["prepare"]>;
    private stmtEvict: ReturnType<Database["prepare"]>;
    private stmtDelete: ReturnType<Database["prepare"]>;

    constructor(dbPath: string) {
        this.db = new Database(dbPath);
        this.db.run("PRAGMA journal_mode = WAL");
        this.db.run(`
            CREATE TABLE IF NOT EXISTS http_cache (
                url              TEXT PRIMARY KEY,
                policy           TEXT NOT NULL,
                status_code      INTEGER NOT NULL,
                content_type     TEXT NOT NULL DEFAULT '',
                location         TEXT NOT NULL DEFAULT '',
                body             BLOB,
                last_accessed_at INTEGER NOT NULL,
                cached_at        INTEGER NOT NULL
            )
        `);

        this.stmtGet = this.db.prepare(
            "SELECT * FROM http_cache WHERE url = ?");
        this.stmtTouch = this.db.prepare(
            "UPDATE http_cache SET last_accessed_at = ?2 WHERE url = ?1");
        this.stmtUpsert = this.db.prepare(`
            INSERT OR REPLACE INTO http_cache
                (url, policy, status_code, content_type, location, body, last_accessed_at, cached_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        `);
        this.stmtCount = this.db.prepare(
            "SELECT COUNT(*) as count FROM http_cache");
        this.stmtEvict = this.db.prepare(
            "DELETE FROM http_cache WHERE url = (SELECT url FROM http_cache ORDER BY last_accessed_at ASC LIMIT 1)");
        this.stmtDelete = this.db.prepare(
            "DELETE FROM http_cache WHERE url = ?");
    }

    /**
     * Look up a cached response by URL. Returns null on miss.
     * On hit, updates `last_accessed_at` for LRU tracking.
     */
    get(url: string): CacheEntry | null {
        const row = this.stmtGet.get(url) as CacheRow | null;
        if (!row) return null;

        const now = Math.floor(Date.now() / 1000);
        this.stmtTouch.run(url, now);

        return {
            policy: CachePolicy.fromObject(JSON.parse(row.policy)),
            statusCode: row.status_code,
            contentType: row.content_type,
            location: row.location,
            body: row.body,
        };
    }

    /**
     * Store a response in the cache. If the cache is at capacity, the least
     * recently accessed entry is evicted first.
     *
     * If a entry with the same URL already exists, it is replaced (upsert).
     */
    set(url: string, entry: CacheEntry): void {
        // Evict LRU entry if at capacity (only when inserting a genuinely new URL).
        const existing = this.stmtGet.get(url) as CacheRow | null;
        if (!existing) {
            const { count } = this.stmtCount.get() as { count: number };
            if (count >= MAX_CACHE_ENTRIES) {
                this.stmtEvict.run();
            }
        }

        const now = Math.floor(Date.now() / 1000);
        this.stmtUpsert.run(
            url,
            JSON.stringify(entry.policy.toObject()),
            entry.statusCode,
            entry.contentType,
            entry.location,
            entry.body,
            now,
            existing ? (existing.cached_at) : now);
    }

    /** Delete a cache entry by URL. No-op if the entry doesn't exist. */
    delete(url: string): void {
        this.stmtDelete.run(url);
    }

    /** Number of entries currently in the cache. */
    get size(): number {
        const { count } = this.stmtCount.get() as { count: number };
        return count;
    }
}
