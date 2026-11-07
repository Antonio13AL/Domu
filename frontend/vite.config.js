import { fileURLToPath, URL } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  cacheDir: join(tmpdir(), 'domu-vite-cache'),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    fsModuleCachePath: join(tmpdir(), 'domu-vite-cache', 'vitest'),
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    exclude: ['node_modules/**', 'e2e/**', 'test-results/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/test/**', '**/*.test.{js,jsx}', '**/*.spec.{js,jsx}'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
})
