import * as vite from "vite";
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Set by the Rust host when launched via TurboDoc. When present, Vite
// binds to this port; the WebView2 navigates to it directly, so HMR's
// WebSocket talks to Vite naturally without any clientPort override.
// Unset: Vite uses its defaults (port 5173), so running `bun run vite
// dev` standalone still works for ad-hoc frontend testing.
const VITE_PORT = parseInt(process.env.TURBODOC_VITE_PORT ?? "0", 10);
const VITE_READY_TOKEN = process.env.TURBODOC_VITE_READY_TOKEN;
const VITE_READY_TOKEN_HEADER = "X-TurboDoc-Vite-Ready-Token";

/** Expose host-managed Vite readiness without involving TurboDoc's API interception. */
function readinessEndpoint(readyToken: string | undefined): vite.Plugin {
    return {
        name: "turbodoc-readiness-endpoint",
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const url = new URL(request.url ?? "/", "http://127.0.0.1");
                if (request.method !== "GET" || url.pathname !== "/ready") {
                    next();
                    return;
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
        readinessEndpoint(VITE_READY_TOKEN),
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
