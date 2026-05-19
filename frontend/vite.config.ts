import * as vite from "vite";
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Packages that ship `.svelte` source files in their dist. Vite 7's dep
// optimizer is still esbuild-backed (Rolldown is opt-in), and esbuild has
// no `.svelte` loader; vite-plugin-svelte v7 only registers a Rolldown
// plugin for prebundling, so `.svelte` imports inside these libs error
// during optimization. Exclude them — they're already ESM and don't need
// prebundling. The plugin still handles them on-demand at request time.
const SVELTE_LIBS = [
    "@lucide/svelte",
    "bits-ui",
    "paneforge",
];

// Set by the Rust host in `--dev` mode. When present, Vite binds to this
// port and tells HMR clients to connect to the same port directly — so the
// HMR WebSocket bypasses the Rust reverse proxy and goes browser → Vite.
// Unset: Vite uses its defaults (port 5173, in-page HMR), so running `bun
// run vite dev` standalone still works for ad-hoc frontend testing.
const VITE_PORT = parseInt(process.env.TURBODOC_VITE_PORT ?? "0", 10);

export default vite.defineConfig({
    root: __dirname,
    plugins: [
        tailwindcss(),
        svelte(),
    ],
    resolve: {
        alias: {
            "@/": `${__dirname}/src/`,
            "@shadcn/": `${__dirname}/3rdparty/shadcn/`,
        },
    },
    optimizeDeps: { exclude: SVELTE_LIBS },
    ssr: { optimizeDeps: { exclude: SVELTE_LIBS } },
    clearScreen: false,
    server: VITE_PORT > 0 ? {
        host: "127.0.0.1",
        port: VITE_PORT,
        strictPort: true,
        hmr: { clientPort: VITE_PORT },
    } : undefined,
});
