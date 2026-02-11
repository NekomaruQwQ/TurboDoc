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

const port = 9680;

console.log("JavaScript Runtime:", process.execPath.replaceAll("\\", "/"));

import path from "node:path";
import url from "node:url";

const __filename =
    url.fileURLToPath(import.meta.url);
const __dirname =
    path.dirname(__filename);

// This file is located at src/server/index.ts, so the base dir is two levels up.
const baseDir =
    path.resolve(`${__dirname}/../..`);
const dataDir =
    path.resolve(`${baseDir}/target/data`);

console.log(`baseDir: ${baseDir.replaceAll("\\", "/")}`);
console.log(`dataDir: ${dataDir.replaceAll("\\", "/")}`);

// == HTTP Cache Initialization ==

import { HttpCache } from "./cache";

const httpCachePath =
    path.resolve(`${dataDir}/http-cache.sqlite`);
const httpCache =
    new HttpCache(httpCachePath);

console.log(`httpCache: ${httpCachePath.replaceAll("\\", "/")} (${httpCache.size} entries)`);

// == Hono Server for API + Proxy ==

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator"
import { createProxyRoute } from "./proxy";

const workspacePath =
    path.resolve(`${dataDir}/workspace.json`);
const cachePath =
    path.resolve(`${dataDir}/cache.json`);

const honoApp =
    new Hono()
        .get("/api/v1/workspace", async c => {
            console.log(`Reading workspace from ${workspacePath}`);
            return c.body(await Bun.file(workspacePath).text(), {
                headers: { "Content-Type": "application/json" },
            });
        })
        .put("/api/v1/workspace", zValidator("json", z.unknown()), async c => {
            console.log(`Writing workspace to ${workspacePath}`);
            await Bun.write(workspacePath, JSON.stringify(await c.req.valid("json")));
            return c.json({ success: true });
        })
        .get("/api/v1/cache", async c => {
            console.log(`Reading cache from ${cachePath}`);
            return c.body(await Bun.file(cachePath).text(), {
                headers: { "Content-Type": "application/json" },
            });
        })
        .put("/api/v1/cache", zValidator("json", z.unknown()), async c => {
            console.log(`Writing cache to ${cachePath}`);
            await Bun.write(cachePath, JSON.stringify(await c.req.valid("json")));
            return c.json({ success: true });
        })
        .route("/", createProxyRoute(httpCache));

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
    console.log(`Server running at http://localhost:${port}`);
});
