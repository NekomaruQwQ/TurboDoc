// Entry point of the TurboDoc server.
//
// The TurboDoc server has three parts:
// 1. The API server powered by Hono (workspace/cache CRUD);
// 2. The HTTP proxy for documentation pages (with SQLite caching);
// 3. The frontend asset server powered by Vite;
//
// To make the three parts work together in Bun, we create a node:http server
// via the Bun NodeJS Compat Layer and route requests to either Hono or Vite
// based on the URL path.
//
// Running the server with `bun --hot` enables hot reload for the server.
// The frontend assets are always hot-reloaded by Vite, regardless of the
// bun flags.

// == Setup and Configuration ==

/** Port for the server to listen on. */
const port = 9680;
const baseUrl = `http://localhost:${port}`;

/** Format a filesystem path for logging, replacing backslashes with slashes. */
const formatPath = (path: string) => path.replaceAll("\\", "/");

console.log("JavaScript Runtime:", formatPath(process.execPath));

import path from "node:path";
import url from "node:url";

const __filename =
    url.fileURLToPath(import.meta.url);
const __dirname =
    path.dirname(__filename);

/** The repository root directory, containing package.json. */
const baseDir =
    // This file is located at src/server/index.ts, so the base dir is two levels up.
    path.resolve(`${__dirname}/../..`);
/** The server data directory, containing the SQLite cache and JSON workspace/cache dumps. */
const dataDir =
    path.resolve(`${baseDir}/target/data`);

console.log(`baseDir: ${formatPath(baseDir)}`);
console.log(`dataDir: ${formatPath(dataDir)}`);

const httpCachePath =
    path.resolve(`${dataDir}/cache.sqlite`);
const workspacePath =
    path.resolve(`${dataDir}/workspace.json`);
const cachePath =
    path.resolve(`${dataDir}/cache.json`);

console.log(`httpCache: ${formatPath(httpCachePath)}`);
console.log(`workspace: ${formatPath(workspacePath)}`);
console.log(`cache: ${formatPath(cachePath)}`);

// == Hono Server for API + Proxy ==

import type { Context as HonoContext } from "hono";
import { Hono } from "hono";

import { HttpCache } from "@/server/cache";
import { createProxyRoute } from "@/server/proxy";

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

const honoApi =
    new Hono()
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
        .put("/cache", async c => saveDataAsJson(c, `${dataDir}/cache.json`));

const honoProxy =
    createProxyRoute(new HttpCache(httpCachePath));
const honoApp =
    new Hono()
        .route("/api/v1", honoApi)
        .route("/proxy", honoProxy);

export type HonoApp = typeof honoApp;

// == Main Server Setup ==

import * as http from "node:http";
import * as vite from "vite";
import * as hono from "@hono/node-server";

const honoServer =
    hono.getRequestListener(honoApp.fetch);
const viteServer =
    await vite.createServer({ server: { middlewareMode: true } });
const httpServer =
    http.createServer(async (req, res) => {
        if (req.url?.startsWith("/api") ||
            req.url?.startsWith("/proxy")) {
            honoServer(req, res);
        } else {
            viteServer.middlewares(req, res);
        }
    });

httpServer.listen(port, () => {
    console.log(`Server running at ${baseUrl}`);
});
