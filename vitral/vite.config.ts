import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"

function normalizeBasePath(value: string | undefined): string {
    const trimmed = (value ?? "").trim();
    if (!trimmed || trimmed === "/") return "/";
    const normalized = trimmed.replace(/^\/+|\/+$/g, "");
    return `/${normalized}/`;
}

export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const configuredBase = normalizeBasePath(env.VITE_BASE_PATH);

    return {
        // Keep dev server at root even if production is deployed under a subpath.
        base: command === "serve" ? "/" : configuredBase,
        plugins: [react()],
        preview: {
            port: 5173,
            strictPort: true,
        },
        server: {
            port: 5173,
            strictPort: true,
            host: true,
            origin: "http://0.0.0.0:5173",
        },
        resolve: {
            alias: {
                '@': path.resolve(__dirname, 'src'),
            },
        },
    };
});
