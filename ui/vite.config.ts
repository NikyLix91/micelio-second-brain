/**
 * Configurazione Vite della UI.
 *
 * - `base: '/ui/'`: la UI è servita dal daemon sotto /ui (vedi src/daemon/micelio.module.ts).
 * - `build.outDir`: la build finisce in dist/ui accanto al daemon compilato, così il daemon la trova.
 * - In sviluppo (`npm run dev -w ui`) le chiamate /api vengono inoltrate al daemon locale.
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const DAEMON = process.env.MICELIO_DAEMON_URL ?? 'http://127.0.0.1:7337'

export default defineConfig({
  base: '/ui/',
  plugins: [react()],
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true
  },
  server: {
    proxy: { '/api': DAEMON }
  }
})
