import type { Context as HonoContext } from "hono";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import path from "node:path";

import * as TOML from "smol-toml";

import { dataDir } from "@server/common";
import * as cratesCache from "@server/crates-cache";
import { type CrateMetadata, parseCrateMetadata } from "@server/crates-cache";

export type { CrateMetadata } from "@server/crates-cache";

/** Load a TOML data file, parse it, and return as a JSON response body. The
 *  on-disk format is TOML; the wire format is JSON, so the frontend (and the
 *  Hono client typing) sees no difference from the old JSON-on-disk era.
 *  Returns `{}` if the file doesn't exist (e.g., first launch). */
async function loadDataFile(c: HonoContext, dataPath: string) {
    const file = Bun.file(path.resolve(dataPath));
    if (!await file.exists())
        return c.json({});
    const text = await file.text();
    // Cast smol-toml's recursive `TomlObject` to a simpler shape so Hono's
    // client-type inference doesn't blow past its instantiation depth limit.
    return c.json(TOML.parse(text) as Record<string, unknown>);
}

/** Serialize `data` (a plain object received as JSON over the wire) to TOML
 *  and write it to disk. Both `AppData` and `ProviderData` have object roots
 *  by schema, which `smol-toml` requires for the top level. */
async function saveDataFile(
    c: HonoContext, dataPath: string, data: unknown,
) {
    const text = TOML.stringify(data as Record<string, unknown>);
    await Bun.write(path.resolve(dataPath), text);
    return c.json({ success: true });
}

/** Minimum existing file size (bytes) below which the data loss guard is
 *  skipped. Small files can legitimately shrink by large ratios (e.g.,
 *  removing 2 of 3 crates), so the percentage check would cause false
 *  positives. */
const DATA_LOSS_MIN_SIZE = 256;
/** If the new payload is smaller than this fraction of the existing file,
 *  the write is rejected as likely accidental data loss. */
const DATA_LOSS_RATIO = 0.3;

/** Compare the size of `newPayload` against the existing file at `filePath`.
 *  Returns an error message if the write looks like accidental data loss,
 *  or `null` if the write is safe. The byte-length comparison is format-
 *  agnostic — works equally for the JSON era and the current TOML files.
 *
 *  Future: a `?force=true` query parameter could bypass this check for
 *  legitimate bulk deletions. */
async function guardAgainstDataLoss(
    filePath: string, newPayload: string,
): Promise<string | null> {
    const file = Bun.file(filePath);
    if (!await file.exists()) return null;

    const existingSize = file.size;
    if (existingSize < DATA_LOSS_MIN_SIZE) return null;

    const ratio = newPayload.length / existingSize;
    if (ratio < DATA_LOSS_RATIO)
        return `Write rejected: new payload (${newPayload.length} B) is ${(ratio * 100).toFixed(1)}% ` +
            `of existing file (${existingSize} B), which is below the ${DATA_LOSS_RATIO * 100}% safety threshold.`;

    return null;
}

export default new Hono()
    .use(async (c, next) => {
        await next();
        console.log(
            `${c.req.method} ` +
            `${c.req.path} ` +
            `-> ${c.res.status} (${c.res.headers.get("Content-Type") || ""})`);
    })
    // Static data routes (registered before :providerId to avoid shadowing).
    .get("/data/preset", async c =>
        loadDataFile(c, `${dataDir}/preset.toml`))
    .put("/data/preset", zValidator("json", z.unknown()), async c =>
        saveDataFile(c, `${dataDir}/preset.toml`, c.req.valid("json")))
    // Per-provider data.
    .get("/data/:providerId", async c => {
        const { providerId } = c.req.param();
        return loadDataFile(c, `${dataDir}/${providerId}.toml`);
    })
    .put("/data/:providerId", zValidator("json", z.unknown()), async c => {
        const { providerId } = c.req.param();
        const filePath = path.resolve(`${dataDir}/${providerId}.toml`);
        const data = c.req.valid("json");
        const text = TOML.stringify(data as Record<string, unknown>);

        const rejection = await guardAgainstDataLoss(filePath, text);
        if (rejection) {
            console.warn(rejection);
            return c.json({ success: false, error: rejection }, 409);
        }

        await Bun.write(filePath, text);
        return c.json({ success: true });
    })
    // Batch crate metadata lookup. Returns normalized metadata for each
    // requested crate. Fresh cache hits are served immediately; stale or
    // missing entries are refreshed from crates.io in parallel. Stale
    // entries are kept as fallback if upstream fails.
    //
    // ?refresh=true bypasses the freshness check and always fetches
    // upstream. Limited to a single crate to prevent accidental bulk
    // hits to crates.io.
    .post("/crates", async c => {
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
    })
