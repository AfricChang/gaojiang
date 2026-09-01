import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
    plugins: [tailwindcss(), sveltekit()],
    optimizeDeps: {
        exclude: ["@gaojiang/ui"],
    },
    resolve: {
        alias: {
            "@gaojiang/ui": path.resolve(__dirname, "./gaojiang-ui/src/lib/index.ts"),
        },
    },
    server: {
        fs: {
            allow: ["./gaojiang-ui"],
        },
    },
});
