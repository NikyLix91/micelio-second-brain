import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // SWC al posto di esbuild: NestJS richiede emitDecoratorMetadata, che esbuild non supporta.
  // EN: SWC instead of esbuild: NestJS needs emitDecoratorMetadata, which esbuild doesn't support.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    // Cancella a fine esecuzione le cartelle temporanee create dai test (vedi il file)
    // EN: Deletes the temporary folders created by the tests at the end of the run (see the file)
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // I test di integrazione aprono DHT di test e swarm: meglio non sovrapporli.
    // EN: Integration tests open test DHTs and swarms: better not to run them in parallel.
    fileParallelism: false
  }
})
