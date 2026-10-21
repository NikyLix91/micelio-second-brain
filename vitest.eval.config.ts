/**
 * Configurazione vitest per le valutazioni con il LLM reale (`npm run eval:ingest`).
 * Separata da quella dei test normali: consuma l'abbonamento e richiede minuti.
 *
 * EN: Vitest config for evaluations with the real LLM (`npm run eval:ingest`).
 * Kept apart from the normal test config: it uses up the subscription and takes minutes.
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
