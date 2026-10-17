/**
 * Fase 4 su nodi reali (DHT locale): cartelle di documenti sorvegliate, distillazione con
 * riferimento alla fonte, blocco per percorso, download dell'originale fra colleghi.
 *
 * Il LLM è quello finto: distilla un ricordo per ogni riga "LEZIONE: titolo | corpo" del testo.
 * I DOCX sono veri, generati con officeparser da Markdown.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canonicalPath } from '../../src/node/config'
import type { MicelioNode } from '../../src/node/micelio-node'
import { eventually, localDht, makeNode, tmpHome } from '../helpers'

/** Crea un DOCX vero a partire da Markdown. */
async function writeDocx (file: string, markdown: string): Promise<void> {
  // Il Markdown d'appoggio sta fuori dalle cartelle sorvegliate (ed estensione .md: officeparser
  // riconosce il formato dall'estensione).
  const md = path.join(tmpHome('md'), 'sorgente.md')
  fs.writeFileSync(md, markdown)
  const { OfficeConverter } = require('officeparser')
  const out = await OfficeConverter.convert(md, 'docx')
  fs.writeFileSync(file, Buffer.from(out.value))
  fs.rmSync(md)
}

describe('documenti', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  let alice: MicelioNode, bob: MicelioNode
  const shared = tmpHome('docs-shared')
  const priv = tmpHome('docs-private')

  /** Elabora la coda di alice finché c'è lavoro e la condizione non è vera. */
  const drain = (cond: () => boolean | Promise<boolean>) => eventually(async () => { await alice.processQueue(); return cond() }, [alice], 40_000)

  beforeAll(async () => {
    dht = await localDht()
    alice = makeNode('alice', dht.bootstrap).node
    bob = makeNode('bob', dht.bootstrap).node
    await alice.start(); await bob.start()
    await alice.init('Team Doc', 'alice')
    await bob.join((await alice.invite()).code, 'bob')

    fs.mkdirSync(path.join(shared, 'HR'))
    await writeDocx(path.join(shared, 'rilasci.docx'), '# Procedura di rilascio\n\nLEZIONE: Tag di versione avvia la release | Il tag vX.Y.Z fa partire la pipeline di release.\n')
    fs.writeFileSync(path.join(shared, 'HR', 'valutazioni.md'), 'LEZIONE: Non deve uscire | Contenuto in una cartella HR.\n')
    fs.writeFileSync(path.join(priv, 'interno.md'), '# Note interne\n\nLEZIONE: Rotazione dei segreti trimestrale | I segreti si ruotano ogni tre mesi dal Key Vault.\n')
    await alice.documentsAdd(shared, true)
    await alice.documentsAdd(priv, false)
  })

  afterAll(async () => {
    await alice?.stop(); await bob?.stop()
    await dht?.destroy()
  })

  it('i documenti vengono distillati in ricordi con il riferimento all\'originale', async () => {
    await drain(() => alice.recall('tag versione release').length > 0 && alice.recall('rotazione segreti').length > 0)
    const hit = alice.recall('tag versione release')[0]
    expect(hit.source).toMatchObject({ type: 'document', name: 'rilasci.docx' })
    expect(hit.source?.ref).toMatch(/^[0-9a-f]{64}$/)
    expect(alice.documentStats().done).toBeGreaterThanOrEqual(2)
  })

  it('un documento in una cartella protetta (HR) non viene nemmeno letto', async () => {
    await drain(() => alice.decisions().some((d) => d.reason.includes('percorso protetto')))
    expect(alice.recall('non deve uscire')).toEqual([])
  })

  it('un collega scarica l\'originale da una cartella condivisibile, identico al file', async () => {
    const id = alice.recall('tag versione release')[0].id
    await eventually(() => bob.get(id) !== null, [bob])
    const r = await bob.fetchSource(id)
    expect(r.local).toBe(false)
    expect(fs.readFileSync(r.path).equals(fs.readFileSync(path.join(shared, 'rilasci.docx')))).toBe(true)
    // Il testo è estraibile (per il tool MCP)
    expect(await bob.sourceText(r.path)).toContain('Procedura di rilascio')
    // Seconda richiesta: dalla cache, senza rete
    expect((await bob.fetchSource(id)).local).toBe(true)
  })

  it('l\'originale di una cartella NON condivisibile viene rifiutato', async () => {
    const id = alice.recall('rotazione segreti')[0].id
    await eventually(() => bob.get(id) !== null, [bob])
    await expect(bob.fetchSource(id)).rejects.toThrow(/non condivide/)
  })

  it('il proprietario ottiene il proprio file locale, senza download', async () => {
    const r = await alice.fetchSource(alice.recall('rotazione segreti')[0].id)
    expect(r.local).toBe(true)
    expect(r.path).toBe(path.join(canonicalPath(priv), 'interno.md')) // percorso canonico (nomi lunghi su Windows)
  })

  it('un ricordo che non viene da un documento non ha originale', async () => {
    const res = await alice.remember({ title: 'Ricordo scritto a mano', body: 'Contenuto tecnico scritto a mano dal terminale.' })
    if (res.outcome !== 'team') throw new Error(res.outcome)
    await expect(alice.fetchSource(res.id)).rejects.toThrow(/non viene da un documento/)
  })
})
