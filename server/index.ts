// Entry point of the TurboDoc server.
//
// The TurboDoc server has three parts:
// 1. The API server powered by Hono (data/cache CRUD);
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

import { Hono } from "hono";

import * as http from "node:http";
import * as path from "node:path";
import * as vite from "vite";
import * as hono from "@hono/node-server";

import { writeFileSync } from "node:fs";

import { serverHost, serverPort, dataDir } from "@server/common";
import api from "@server/api";
import proxy from "@server/proxy";

const honoApp =
    new Hono()
        .route("/proxy", proxy)
        .route("/api/v1", api);
export type HonoApp = typeof honoApp;

const honoServer =
    hono.getRequestListener(honoApp.fetch);
const viteServer =
    await vite.createServer({
        configFile: path.resolve(__dirname, "../frontend/vite.config.ts"),
        server: {
            middlewareMode: true,
            hmr: {
                port: serverPort + 10000,
            }
        },
    });
const httpServer =
    http.createServer(async (req, res) => {
        if (req.url?.startsWith("/api") ||
            req.url?.startsWith("/proxy")) {
            await honoServer(req, res);
        } else {
            viteServer.middlewares(req, res);
        }
    });

httpServer.listen(serverPort, () => {
    writeFileSync(`${dataDir}/lock.toml`, `port = ${serverPort}\n`);
    console.log(`server running at http://${serverHost}:${serverPort}`);
});
