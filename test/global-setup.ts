/**
 * @file Pulizia delle cartelle temporanee dei test (globalSetup di vitest).
 *
 * EN: Cleanup of the tests' temporary folders (vitest globalSetup).
 *
 * Ogni test che crea un nodo usa una cartella `%TEMP%/micelio-<nome>-XXXXXX` (test/helpers.ts,
 * tmpHome): corestore, database, repository git di prova. Prima nessuno le cancellava e dopo
 * molte esecuzioni erano oltre 1.300 cartelle, quasi 2 GB (problema di spazio su disco reale).
 * Alla fine dell'esecuzione si cancellano quelle create DURANTE questa esecuzione (si confronta
 * la data di creazione con l'inizio), così non si toccano quelle di eventuali esecuzioni in corso
 * in parallelo né altri file temporanei.
 *
 * EN: Every test that creates a node uses a `%TEMP%/micelio-<nome>-XXXXXX` folder (test/helpers.ts,
 * tmpHome): corestore, database, sample git repositories. Before, nobody deleted them, and after
 * many runs there were over 1,300 folders, almost 2 GB (a real disk space problem).
 * At the end of the run, the ones created DURING this run are deleted (creation time is compared
 * with the start), so folders of other runs going on in parallel and other temporary files
 * are left alone.
 *
 * MICELIO_KEEP_TMP=1 le conserva (per ispezionare i dati di un test fallito).
 *
 * EN: MICELIO_KEEP_TMP=1 keeps them (to inspect the data of a failed test).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export default function setup (): () => void {
  const started = Date.now() - 1000
  return () => {
    if (process.env.MICELIO_KEEP_TMP) return
    const dir = os.tmpdir()
    let removed = 0
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('micelio-')) continue
      const full = path.join(dir, name)
      try {
        if (fs.statSync(full).birthtimeMs < started) continue
        fs.rmSync(full, { recursive: true, force: true, maxRetries: 3 })
        removed++
      } catch { /* file ancora aperto (Windows): resterà, verrà ripreso alla prossima esecuzione / EN: file still open (Windows): it stays, and will be picked up on the next run */ }
    }
    if (removed) console.log(`[test] cartelle temporanee rimosse: ${removed}`)
  }
}
