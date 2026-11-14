import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Must be 5173: the backend's FRONTEND_URL (CORS, email links, OAuth redirects) points here.
    // strictPort fails loudly if it's taken (e.g. the old frontend/ is still running) instead of
    // silently moving to 5174, where every API call would be rejected by CORS.
    port: 5173,
    strictPort: true
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
