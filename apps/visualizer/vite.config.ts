import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Both ports are named. The UI's was hardcoded, so the only way to move it was
// to edit this file — which a stamped repository is not supposed to have to do.
const API_PORT = process.env.CRUST_BE_PORT ?? '4600'
const UI_PORT = Number(process.env.CRUST_FE_PORT ?? 4601)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      // Outside this app, deliberately: one settlement module for the UI and
      // the runtime both. Mirrored in tsconfig.json's `paths`.
      '@typedefs': fileURLToPath(
        new URL('../../lib/typedefs/src', import.meta.url),
      ),
    },
  },
  server: {
    port: UI_PORT,
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
