import * as vite from "vite";
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Set by the Rust host when launched via TurboDoc. When present, Vite
// binds to this port; the WebView2 navigates to it directly, so HMR's
// WebSocket talks to Vite naturally without any clientPort override.
// Unset: Vite uses its defaults for tooling that imports this configuration.
// The application itself requires the native host lifecycle API.
const VITE_PORT = parseInt(process.env.TURBODOC_VITE_PORT ?? "0", 10);
const VITE_READY_TOKEN = process.env.TURBODOC_VITE_READY_TOKEN;
const VITE_READY_TOKEN_HEADER = "X-TurboDoc-Vite-Ready-Token";

/** Vite's disposition for one request path at its API boundary. */
export type ViteApiRequestKind =
    | "passthrough"
    | "ready"
    | "method-not-allowed"
    | "not-found";

/** Classify the Vite-owned readiness route and reject its remaining API namespace. */
export function classifyViteApiRequest(
    method: string | undefined, pathname: string,
): ViteApiRequestKind {
    if (pathname !== "/api" && !pathname.startsWith("/api/")) return "passthrough";
    if (pathname !== "/api/ready") return "not-found";
    return method === "GET" ? "ready" : "method-not-allowed";
}

/** Expose host-managed readiness and prevent API paths from reaching Vite content. */
function apiEndpoints(readyToken: string | undefined): vite.Plugin {
    return {
        name: "turbodoc-api-endpoints",
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const url = new URL(request.url ?? "/", "http://127.0.0.1");
                switch (classifyViteApiRequest(request.method, url.pathname)) {
                    case "passthrough":
                        next();
                        return;
                    case "method-not-allowed":
                        response.writeHead(405, {
                            "Allow": "GET",
                            "Cache-Control": "no-store",
                            "Content-Length": "0",
                        });
                        response.end();
                        return;
                    case "not-found":
                        response.writeHead(404, {
                            "Cache-Control": "no-store",
                            "Content-Length": "0",
                        });
                        response.end();
                        return;
                    case "ready":
                        break;
                }

                if (!readyToken) {
                    response.writeHead(503, {
                        "Cache-Control": "no-store",
                        "Content-Length": "0",
                    });
                    response.end();
                    return;
                }

                response.writeHead(200, {
                    "Cache-Control": "no-store",
                    "Content-Length": "0",
                    [VITE_READY_TOKEN_HEADER]: readyToken,
                });
                response.end();
            });
        },
    };
}

export default vite.defineConfig({
    root: __dirname,
    plugins: [
        apiEndpoints(VITE_READY_TOKEN),
        tailwindcss(),
        svelte(),
    ],
    resolve: {
        alias: {
            "@/": `${__dirname}/src/`,
            "@shadcn/": `${__dirname}/3rdparty/shadcn/`,
        },
    },
    clearScreen: false,
    server: VITE_PORT > 0 ? {
        host: "127.0.0.1",
        port: VITE_PORT,
        strictPort: true,
    } : undefined,
});
