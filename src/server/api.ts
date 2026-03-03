import type { Context as HonoContext } from "hono";
import { Hono } from "hono";

import path from "node:path";
import fs from "node:fs/promises";

import { dataDir, baseUrl } from "@/server/common";

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

// -- One-time migration from monolithic workspace.json to split files --

/** Migrate legacy `workspace.json` into split files if it still exists.
 *  Extracts app data, per-provider data, and UI state into separate files,
 *  then renames the original to `workspace.json.migrated`. */
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

    // Extract UI state (expandedItems/expandedGroups) from each provider
    // into a single centralized object keyed by provider ID.
    const uiState: {
        expandedItems: Record<string, string[]>,
        expandedGroups: Record<string, string[]>,
    } = { expandedItems: {}, expandedGroups: {} };

    for (const [pid, pd] of Object.entries(workspace.providers ?? {})) {
        // biome-ignore lint/suspicious/noExplicitAny: same as above.
        const provider = pd as any;
        uiState.expandedItems[pid] = provider.expandedItems ?? [];
        uiState.expandedGroups[pid] = provider.expandedGroups ?? [];

        // Write per-provider data without the UI fields.
        const { expandedItems, expandedGroups, ...providerData } = provider;
        await Bun.write(
            path.resolve(`${dataDir}/workspace.${pid}.json`),
            JSON.stringify(providerData, undefined, 4));
    }

    await Bun.write(
        path.resolve(`${dataDir}/workspace.ui.json`),
        JSON.stringify(uiState, undefined, 4));

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
    .get("/workspace/ui", async c =>
        loadDataAsJson(c, `${dataDir}/workspace.ui.json`))
    .put("/workspace/ui", async c =>
        saveDataAsJson(c, `${dataDir}/workspace.ui.json`))
    // Per-provider workspace data.
    .get("/workspace/:providerId", async c => {
        const { providerId } = c.req.param();
        return loadDataAsJson(c, `${dataDir}/workspace.${providerId}.json`);
    })
    .put("/workspace/:providerId", async c => {
        const { providerId } = c.req.param();
        return saveDataAsJson(c, `${dataDir}/workspace.${providerId}.json`);
    })
    // Per-provider cache (unchanged).
    .get("/cache/:providerId", async c => {
        const { providerId } = c.req.param();
        return loadDataAsJson(c, `${dataDir}/cache.${providerId}.json`);
    })
    .put("/cache/:providerId", async c => {
        const { providerId } = c.req.param();
        return saveDataAsJson(c, `${dataDir}/cache.${providerId}.json`);
    })
