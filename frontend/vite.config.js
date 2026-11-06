import { join } from 'node:path'
import { tmpdir } from 'node:os'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  cacheDir: join(tmpdir(), 'domu-vite-cache'),
})
