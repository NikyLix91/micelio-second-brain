/**
 * Configurazione Vite della UI.
 *
 * - `base: '/ui/'`: la UI è servita dal daemon sotto /ui (vedi src/daemon/micelio.module.ts).
 * - `build.outDir`: la build finisce in dist/ui accanto al daemon compilato, così il daemon la trova.
 * - In sviluppo (`npm run dev -w ui`) le chiamate /api vengono inoltrate al daemon locale.
 *
 * EN: Vite configuration for the UI.
 *
 * - `base: '/ui/'`: the daemon serves the UI under /ui (see src/daemon/micelio.module.ts).
 * - `build.outDir`: the build goes to dist/ui next to the compiled daemon, so the daemon finds it.
 * - In development (`npm run dev -w ui`) /api calls are proxied to the local daemon.
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
