import type { Context as HonoContext } from "hono";
import { Hono } from "hono";

import path from "node:path";
import fs from "node:fs/promises";

import { dataDir, baseUrl } from "@/common";
import * as httpCache from "@/http-cache";
import { handleProxy } from "@/proxy";

/** Load a JSON file and return it as the response body. Returns `{}` if the
 *  file doesn't exist (e.g., first launch). */
async function loadDataAsJson(c: HonoContext, dataPath: string) {
    const file = Bun.file(path.resolve(dataPath));
    if (!await file.exists())
        return c.json({});
    return c.body(await file.arrayBuffer(), {
        headers: { "Content-Type": "application/json" },
    });
}

async function saveDataAsJson(c: HonoContext, dataPath: string) {
    const data = await c.req.json<unknown>();
    await Bun.write(path.resolve(dataPath), JSON.stringify(data, undefined, 4));
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

/** Compare the size of `newJson` against the existing file at `filePath`.
 *  Returns an error message if the write looks like accidental data loss,
 *  or `null` if the write is safe.
 *
 *  Future: a `?force=true` query parameter could bypass this check for
 *  legitimate bulk deletions. */
async function guardAgainstDataLoss(
    filePath: string, newJson: string,
): Promise<string | null> {
    const file = Bun.file(filePath);
    if (!await file.exists()) return null;

    const existingSize = file.size;
    if (existingSize < DATA_LOSS_MIN_SIZE) return null;

    const ratio = newJson.length / existingSize;
    if (ratio < DATA_LOSS_RATIO)
        return `Write rejected: new payload (${newJson.length} B) is ${(ratio * 100).toFixed(1)}% ` +
            `of existing file (${existingSize} B), which is below the ${DATA_LOSS_RATIO * 100}% safety threshold.`;

    return null;
}

// -- One-time migrations (run before any requests are served) --

/** Migrate legacy `workspace.json` into split files if it still exists.
 *  Extracts app data and per-provider data into separate files, then
 *  renames the original to `workspace.json.migrated`.
 *  UI state (expandedItems/expandedGroups) is dropped — it now lives
 *  in the frontend's localStorage and will start fresh. */
async function migrateFromMonolithic(): Promise<void> {
    const oldPath = path.resolve(`${dataDir}/workspace.json`);
    const oldFile = Bun.file(oldPath);
    if (!await oldFile.exists()) return;

    // biome-ignore lint/suspicious/noExplicitAny: migration deals with unknown legacy shape.
    const workspace = await oldFile.json() as any;

    // Write preset data.
    if (workspace.app) {
        await Bun.write(
            path.resolve(`${dataDir}/preset.json`),
            JSON.stringify(workspace.app, undefined, 4));
    }

    for (const [pid, pd] of Object.entries(workspace.providers ?? {})) {
        // biome-ignore lint/suspicious/noExplicitAny: same as above.
        const provider = pd as any;
        // Strip UI-only fields before writing per-provider data.
        const { expandedItems, expandedGroups, ...providerData } = provider;
        await Bun.write(
            path.resolve(`${dataDir}/${pid}.json`),
            JSON.stringify(providerData, undefined, 4));
    }

    // Rename the old file so migration doesn't run again.
    await fs.rename(oldPath, `${oldPath}.migrated`);
    console.log("Migrated workspace.json → split files.");
}

/** Rename `workspace.*.json` files to drop the `workspace.` prefix.
 *  Handles the transition from `workspace.preset.json` → `preset.json`
 *  and `workspace.<providerId>.json` → `<providerId>.json`. */
async function migrateFromWorkspacePrefix(): Promise<void> {
    const dir = path.resolve(dataDir);
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
        if (!entry.startsWith("workspace.") || !entry.endsWith(".json"))
            continue;
        // Strip "workspace." prefix.
        const newName = entry.slice("workspace.".length);
        const oldPath = path.join(dir, entry);
        const newPath = path.join(dir, newName);
        await fs.rename(oldPath, newPath);
        console.log(`Renamed ${entry} → ${newName}`);
    }
}

await migrateFromMonolithic();
await migrateFromWorkspacePrefix();

// -- Crate metadata normalization --

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

/** Parse a raw crates.io API response body into `CrateMetadata`.
 *  Returns `null` if the body is malformed or missing required fields. */
function parseCrateMetadata(
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

export default new Hono()
    .use(async (c, next) => {
        await next();
        console.log(
            `${c.req.method} ` +
            `${c.req.url.replace(baseUrl, "")} ` +
            `-> ${c.res.status} (${c.res.headers.get("Content-Type") || ""})`);
    })
    // Static data routes (registered before :providerId to avoid shadowing).
    .get("/data/preset", async c =>
        loadDataAsJson(c, `${dataDir}/preset.json`))
    .put("/data/preset", async c =>
        saveDataAsJson(c, `${dataDir}/preset.json`))
    // Per-provider data.
    .get("/data/:providerId", async c => {
        const { providerId } = c.req.param();
        return loadDataAsJson(c, `${dataDir}/${providerId}.json`);
    })
    .put("/data/:providerId", async c => {
        const { providerId } = c.req.param();
        const filePath = path.resolve(`${dataDir}/${providerId}.json`);
        const data = await c.req.json<unknown>();
        const json = JSON.stringify(data, undefined, 4);

        const rejection = await guardAgainstDataLoss(filePath, json);
        if (rejection) {
            console.warn(rejection);
            return c.json({ success: false, error: rejection }, 409);
        }

        await Bun.write(filePath, json);
        return c.json({ success: true });
    })
    // Batch crate metadata lookup. Returns normalized metadata for each
    // requested crate. Cache hits are served from the SQLite HTTP cache;
    // cache misses are fetched upstream via the proxy (in parallel).
    .post("/crates", async c => {
        const body = await c.req.json<{ names?: unknown }>();
        const names = body?.names;
        if (!Array.isArray(names) || !names.every(n => typeof n === "string"))
            return c.json({ error: "Expected { names: string[] }" }, 400);

        const results: Record<string, CrateMetadata | null> = {};
        const misses: string[] = [];

        // Phase 1: serve from cache.
        for (const name of names as string[]) {
            const url = `https://crates.io/api/v1/crates/${name}`;
            const cached = httpCache.get(url);
            if (cached?.body) {
                results[name] = parseCrateMetadata(name, cached.body);
            } else {
                misses.push(name);
            }
        }

        // Phase 2: fetch upstream for cache misses (in parallel).
        if (misses.length > 0) {
            const fetches = misses.map(async name => {
                const url = `https://crates.io/api/v1/crates/${name}`;
                try {
                    const result = await handleProxy(url);
                    if (result.status === 200 && result.body) {
                        results[name] = parseCrateMetadata(name, result.body);
                    } else {
                        results[name] = null;
                    }
                } catch {
                    results[name] = null;
                }
            });
            await Promise.all(fetches);
        }

        return c.json(results);
    })
