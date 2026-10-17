/**
 * Configurazione vitest per le valutazioni con il LLM reale (`npm run eval:ingest`).
 * Separata da quella dei test normali: consuma l'abbonamento e richiede minuti.
 */
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/eval/**/*.eval.ts'],
    testTimeout: 15 * 60_000
  }
})
