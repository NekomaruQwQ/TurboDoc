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

export default vite.defineConfig({
    root: __dirname,
    plugins: [
        tailwindcss(),
        svelte(),
    ],
    resolve: {
        alias: {
            "@": __dirname,
            "@server": `${__dirname}/../server/`,
            "@shadcn": `${__dirname}/3rdparty/shadcn/`,
        },
    },
    optimizeDeps: { exclude: SVELTE_LIBS },
    ssr: { optimizeDeps: { exclude: SVELTE_LIBS } },
    clearScreen: false,
});
