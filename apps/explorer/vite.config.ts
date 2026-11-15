import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import { serveData } from './vite-plugins/serve-data.ts'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    serveData({
      '/data/jezero-v1/models/examples': path.resolve(import.meta.dirname, '../../examples'),
      '/data/jezero-v1/models': path.resolve(import.meta.dirname, '../../models/jezero-v1'),
      '/data/jezero-v1/baselines': path.resolve(import.meta.dirname, '../../bench/jezero-v1/baselines'),
      '/data/jezero-v1': path.resolve(import.meta.dirname, '../../data/processed/jezero-v1'),
    }),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  worker: { format: 'es' },
  build: {
    target: 'es2023',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three'
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
