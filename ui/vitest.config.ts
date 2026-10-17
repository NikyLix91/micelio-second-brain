/**
 * Configurazione dei test della UI: i componenti girano in jsdom (un DOM simulato), quindi
 * nessun browser da scaricare. Uso: npm test -w ui (oppure `npm run test:ui` dalla radice).
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}']
  }
})
