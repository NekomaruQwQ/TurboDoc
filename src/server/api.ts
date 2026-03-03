import type { Context as HonoContext } from "hono";
import { Hono } from "hono";

import path from "node:path";

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

export default new Hono()
    .use(async (c, next) => {
        await next();
        console.log(
            `${c.req.method} ` +
            `${c.req.url.replace(baseUrl, "")} ` +
            `-> ${c.res.status} (${c.res.headers.get("Content-Type") || ""})`);
    })
    .get("/workspace", async c => loadDataAsJson(c, `${dataDir}/workspace.json`))
    .put("/workspace", async c => saveDataAsJson(c, `${dataDir}/workspace.json`))
    .get("/cache/:providerId", async c => {
        const { providerId } = c.req.param();
        return loadDataAsJson(c, `${dataDir}/cache.${providerId}.json`);
    })
    .put("/cache/:providerId", async c => {
        const { providerId } = c.req.param();
        return saveDataAsJson(c, `${dataDir}/cache.${providerId}.json`);
    })
