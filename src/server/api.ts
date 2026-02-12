import type { Context as HonoContext } from "hono";
import { Hono } from "hono";

import path from "node:path";

import { dataDir, baseUrl } from "@/server/common";

async function loadDataAsJson(c: HonoContext, dataPath: string) {
    return c.body(await Bun.file(path.resolve(dataPath)).arrayBuffer(), {
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
    .get("/cache", async c => loadDataAsJson(c, `${dataDir}/cache.json`))
    .put("/cache", async c => saveDataAsJson(c, `${dataDir}/cache.json`))
