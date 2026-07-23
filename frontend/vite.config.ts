import * as vite from "vite";
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Set by the Rust host when launched via TurboDoc. When present, Vite
// binds to this port; the WebView2 navigates to it directly, so HMR's
// WebSocket talks to Vite naturally without any clientPort override.
// Unset: Vite uses its defaults (port 5173), so running `bun run vite
// dev` standalone still works for ad-hoc frontend testing.
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
    clearScreen: false,
    server: VITE_PORT > 0 ? {
        host: "127.0.0.1",
        port: VITE_PORT,
        strictPort: true,
    } : undefined,
});
