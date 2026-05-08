import * as vite from "vite";
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default vite.defineConfig({
    root: __dirname,
    plugins: [
        svelte(),
        tailwindcss(),
    ],
    resolve: {
        alias: {
            "@": __dirname,
            "@server": __dirname + "/../server",
            "@shadcn": __dirname + "/3rdparty/shadcn",
        },
    },
    clearScreen: false,
});
