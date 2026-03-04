import * as vite from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

export default vite.defineConfig({
    root: __dirname,
    plugins: [
        react(),
        tailwindcss(),
    ],
    resolve: {
        alias: {
            "@": __dirname,
            "@server": __dirname + "/../server",
            "@shadcn": __dirname + "/3rdparty/shadcn",
        },
    },
});
