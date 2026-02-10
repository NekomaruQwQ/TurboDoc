// Entry point of the TurboDoc server.
//
// The TurboDoc server has two parts:
// 1. The API server powered by Hono;
// 2. The frontend asset server powered by Vite;
//
// To make the two parts work together in Bun, we create an node:http server
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

// == Hono Server for API Endpoints ==

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator"

const workspacePath =
    path.resolve(`${dataDir}/workspace.json`);
const cachePath =
    path.resolve(`${dataDir}/cache.json`);

const honoApp =
    new Hono()
        .get("/api/v1/workspace", async c => {
            console.log(`Reading workspace from ${workspacePath}`);
            return c.json(await Bun.file(workspacePath).text());
        })
        .put("/api/v1/workspace", zValidator("json", z.unknown()), async c => {
            console.log(`Writing workspace to ${workspacePath}`);
            await Bun.write(workspacePath, JSON.stringify(await c.req.valid("json")));
            return c.json({ success: true });
        })
        .get("/api/v1/cache", async c => {
            console.log(`Reading cache from ${cachePath}`);
            return c.json(await Bun.file(cachePath).text());
        })
        .put("/api/v1/cache", zValidator("json", z.unknown()), async c => {
            console.log(`Writing cache to ${cachePath}`);
            await Bun.write(cachePath, JSON.stringify(await c.req.valid("json")));
            return c.json({ success: true });
        });

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
        if (req.url?.startsWith("/api/")) {
            honoServer(req, res);
        } else {
            viteServer.middlewares(req, res);
        }
    });

httpServer.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
