import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
    root: "frontend",
    plugins: [
        react(),
        tailwindcss(),
    ],
    resolve: {
        alias: {
            "@":
                path.resolve(__dirname, "frontend"),
            "@shadcn":
                path.resolve(__dirname, "3rdparty", "shadcn"),
        },
    },
    server: {
        port: 9680,
        strictPort: true,
    },
});
