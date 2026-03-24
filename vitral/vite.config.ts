import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "")

  const isDev = command === "serve"
  const base = env.VITE_BASE_PATH || "/"
  const devProxyTarget = env.VITE_DEV_PROXY_TARGET || "http://localhost:3000"

  return {
    base,
    plugins: [react()],

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },

    server: {
      host: true,
      port: 5173,
      strictPort: true,

      // Usually only needed in specific backend-integration setups.
      // Most standalone Vite apps should omit this.
      ...(isDev
        ? {
            proxy: {
              "/api": {
                target: devProxyTarget,
                changeOrigin: true,
              },
            },
          }
        : {}),
    },

    preview: {
      host: true,
      port: 4173,
      strictPort: true,
    },
  }
})
