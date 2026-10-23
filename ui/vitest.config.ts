/**
 * Configurazione dei test della UI: i componenti girano in jsdom (un DOM simulato), quindi
 * nessun browser da scaricare. Uso: npm test -w ui (oppure `npm run test:ui` dalla radice).
 *
 * EN: UI test configuration: components run in jsdom (a simulated DOM), so there is no
 * browser to download. Usage: npm test -w ui (or `npm run test:ui` from the repo root).
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // Nei test la versione è fissa: la scheda «Informazioni» la mostra così com'è
  // EN: In tests the version is fixed: the «Informazioni» (About) card shows it as is
  define: { __MICELIO_VERSION__: JSON.stringify('0.0.0-test') },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}']
  }
})
