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
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const DAEMON = process.env.MICELIO_DAEMON_URL ?? 'http://127.0.0.1:7337'
// Versione dell'app mostrata in Impostazioni → Informazioni (una sola fonte: package.json della radice)
// EN: App version shown in Settings → About (single source: the root package.json)
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  base: '/ui/',
  plugins: [react()],
  define: { __MICELIO_VERSION__: JSON.stringify(VERSION) },
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true
  },
  server: {
    proxy: { '/api': DAEMON }
  }
})
