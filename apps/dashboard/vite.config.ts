import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API = 'http://localhost:4000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Vite reads VITE_* from the repo-root .env, like the API and worker.
  envDir: '../..',
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin in dev: the browser talks to Vite, Vite forwards to the API.
    proxy: {
      '/api': API,
      '/health': API,
      '/ready': API,
      '/socket.io': { target: API, ws: true },
    },
  },
})
