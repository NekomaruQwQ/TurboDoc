import { defineConfig } from "vite";
import preact from '@preact/preset-vite'

export default defineConfig({
    root: "frontend",
    plugins: [
        preact(),
    ],
    server: {
        port: 9680,
        strictPort: true,
    },
});
