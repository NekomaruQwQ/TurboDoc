import { Hono } from "hono";

import * as cratesCache from "../crates-cache";
import { type CrateMetadata, parseCrateMetadata } from "../crates-cache";

export type { CrateMetadata } from "../crates-cache";

// Batch crate metadata lookup. Returns normalized metadata for each
// requested crate. Fresh cache hits are served immediately; stale or
// missing entries are refreshed from crates.io in parallel. Stale
// entries are kept as fallback if upstream fails.
//
// ?refresh=true bypasses the freshness check and always fetches
// upstream. Limited to a single crate to prevent accidental bulk
// hits to crates.io.
export function createCratesHandler() {
    return new Hono().post(async c => {
        const body = await c.req.json<{ names?: unknown }>();
        const names = body?.names;
        if (!Array.isArray(names) || !names.every(n => typeof n === "string"))
            return c.json({ error: "Expected { names: string[] }" }, 400);

        const refresh = c.req.query("refresh") === "true";
        if (refresh && names.length > 1)
            return c.json({ error: "?refresh=true only supports a single crate" }, 400);

        const results: Record<string, CrateMetadata | null> = {};
        const staleFallbacks = new Map<string, Buffer>();
        const toFetch: string[] = [];

        // Phase 1: serve fresh hits from the dedicated crate cache.
        // Skipped entirely when refresh=true — always fetch upstream.
        for (const name of names as string[]) {
            const cached = cratesCache.get(name);
            if (!refresh && cached?.fresh) {
                results[name] = parseCrateMetadata(name, cached.body);
            } else {
                if (cached) staleFallbacks.set(name, cached.body);
                toFetch.push(name);
            }
        }

        // Phase 2: fetch upstream for stale and missing entries (in parallel).
        if (toFetch.length > 0) {
            const fetches = toFetch.map(async name => {
                try {
                    const body = await cratesCache.fetchUpstream(name);
                    if (body) {
                        cratesCache.set(name, body);
                        results[name] = parseCrateMetadata(name, body);
                    } else {
                        // Non-200 upstream — serve stale fallback if available.
                        const fallback = staleFallbacks.get(name);
                        results[name] = fallback ? parseCrateMetadata(name, fallback) : null;
                    }
                } catch {
                    // Network error — serve stale fallback if available.
                    const fallback = staleFallbacks.get(name);
                    results[name] = fallback ? parseCrateMetadata(name, fallback) : null;
                }
            });
            await Promise.all(fetches);
        }

        return c.json(results);
    });
}
