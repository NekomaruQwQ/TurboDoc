import type { Context as HonoContext } from "hono";
import { Hono } from "hono";

import path from "node:path";
import fs from "node:fs/promises";

import { dataDir, baseUrl } from "@/common";

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

// -- One-time migration from monolithic workspace.json to split files --

/** Migrate legacy `workspace.json` into split files if it still exists.
 *  Extracts app data and per-provider data into separate files, then
 *  renames the original to `workspace.json.migrated`.
 *  UI state (expandedItems/expandedGroups) is dropped — it now lives
 *  in the frontend's localStorage and will start fresh. */
async function migrateWorkspace(): Promise<void> {
    const oldPath = path.resolve(`${dataDir}/workspace.json`);
    const oldFile = Bun.file(oldPath);
    if (!await oldFile.exists()) return;

    // biome-ignore lint/suspicious/noExplicitAny: migration deals with unknown legacy shape.
    const workspace = await oldFile.json() as any;

    // Write app data.
    if (workspace.app) {
        await Bun.write(
            path.resolve(`${dataDir}/workspace.app.json`),
            JSON.stringify(workspace.app, undefined, 4));
    }

    for (const [pid, pd] of Object.entries(workspace.providers ?? {})) {
        // biome-ignore lint/suspicious/noExplicitAny: same as above.
        const provider = pd as any;
        // Strip UI-only fields before writing per-provider data.
        const { expandedItems, expandedGroups, ...providerData } = provider;
        await Bun.write(
            path.resolve(`${dataDir}/workspace.${pid}.json`),
            JSON.stringify(providerData, undefined, 4));
    }

    // Rename the old file so migration doesn't run again.
    await fs.rename(oldPath, `${oldPath}.migrated`);
    console.log("Migrated workspace.json → split files.");
}

// Run migration before any requests are served.
await migrateWorkspace();

export default new Hono()
    .use(async (c, next) => {
        await next();
        console.log(
            `${c.req.method} ` +
            `${c.req.url.replace(baseUrl, "")} ` +
            `-> ${c.res.status} (${c.res.headers.get("Content-Type") || ""})`);
    })
    // Static workspace routes (registered before :providerId to avoid shadowing).
    .get("/workspace/app", async c =>
        loadDataAsJson(c, `${dataDir}/workspace.app.json`))
    .put("/workspace/app", async c =>
        saveDataAsJson(c, `${dataDir}/workspace.app.json`))
    // Per-provider workspace data.
    .get("/workspace/:providerId", async c => {
        const { providerId } = c.req.param();
        return loadDataAsJson(c, `${dataDir}/workspace.${providerId}.json`);
    })
    .put("/workspace/:providerId", async c => {
        const { providerId } = c.req.param();
        const filePath = path.resolve(`${dataDir}/workspace.${providerId}.json`);
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
