import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = Number(process.env.GENESIS_BACKEND_PORT ?? process.env.VITE_BACKEND_PORT ?? 8787)
const frontendPort = Number(process.env.GENESIS_FRONTEND_PORT ?? 3310)

export default defineConfig({
  plugins: [react()],
  server: {
    port: frontendPort,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
})
