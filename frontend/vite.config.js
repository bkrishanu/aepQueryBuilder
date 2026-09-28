import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Dev proxy: forwards /api/* to the local Express backend.
  // In production (Vercel), /api/* is served by serverless functions on the same domain
  // so no proxy is needed — the 'server' block is ignored during 'vite build'.
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
