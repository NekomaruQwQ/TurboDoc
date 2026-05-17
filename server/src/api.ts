import type { Context as HonoContext } from "hono";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import path from "node:path";

import * as TOML from "smol-toml";

import { dataDir } from "./common";

import { createCratesHandler } from "./api/crates";

export type { CrateMetadata } from "./crates-cache";

async function loadDataFile(c: HonoContext, fileName: string) {
    const file = Bun.file(path.resolve(fileName));
    const text = await file.text();
    return c.json(TOML.parse(text));
}

async function saveDataFile(c: HonoContext, fileName: string, data: unknown) {
    await Bun.write(path.resolve(fileName), TOML.stringify(data));
    return c.json({ success: true });
}

export default new Hono()
    .use(async (c, next) => {
        await next();
        console.log(
            `${c.req.method} ` +
            `${c.req.path} ` +
            `-> ${c.res.status} (${c.res.headers.get("Content-Type") || ""})`);
    })
    .get("/data/:fileName", async c => {
        const { fileName } = c.req.param();
        return loadDataFile(c, `${dataDir}/${fileName}.toml`);
    })
    .put("/data/:fileName", zValidator("json", z.unknown()), async c => {
        const { fileName } = c.req.param();
        return saveDataFile(c, `${dataDir}/${fileName}.toml`, c.req.valid("json"));
    })
    .route("/crates", createCratesHandler());
