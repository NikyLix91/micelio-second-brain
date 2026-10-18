/**
 * Radici nell'ingestione (Fase 8, 8.4):
 * - testo dai diagrammi: draw.io (in chiaro e compresso), SVG, Mermaid/PlantUML;
 * - il distillatore SUGGERISCE una Radice (decide l'utente);
 * - i documenti di una cartella "di Radici" diventano Radici da soli.
 * LLM finto: "LEZIONE: titolo | corpo | rif: radice=<categoria>" = suggerimento di Radice.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { RootCategory } from '../../src/core/events'
import { drawioText, svgText } from '../../src/ingest/diagrams'
import { hashFile } from '../../src/ingest/documents'
import { extractText, isSupported } from '../../src/ingest/extract'
import { IngestPipeline } from '../../src/ingest/pipeline'
import { FakeAdapter } from '../../src/llm/fake'
import { LlmRunner } from '../../src/llm/runner'
import { mergeRules } from '../../src/privacy/filter'
import { mergeBlockedPaths } from '../../src/privacy/paths'
import { PrivateStore } from '../../src/store/private-store'
import { writeTranscript } from '../fixtures/transcript'
import { tmpHome } from '../helpers'

describe('testo dai diagrammi', () => {
  const MODEL = '<mxGraphModel><root><mxCell id="0"/><mxCell id="2" value="API Gateway" vertex="1"/>' +
    '<mxCell id="3" value="&lt;b&gt;Servizio ordini&lt;/b&gt;&lt;br&gt;Node.js" vertex="1"/><mxCell id="4" value="eventi" edge="1"/>' +
    '<mxCell id="5" value="API Gateway" vertex="1"/></root></mxGraphModel>'

  it('draw.io in chiaro: nome della pagina ed etichette (HTML ripulito, senza doppioni)', () => {
    const t = drawioText(`<mxfile><diagram name="Rete di produzione" id="a">${MODEL}</diagram></mxfile>`)
    expect(t.split('\n')).toEqual(['Pagina: Rete di produzione', '- API Gateway', '- Servizio ordini Node.js', '- eventi'])
  })

  it('draw.io compresso (deflate + base64 + URL encoding, il formato storico)', () => {
    const packed = zlib.deflateRawSync(Buffer.from(encodeURIComponent(MODEL))).toString('base64')
    expect(drawioText(`<mxfile><diagram name="P1">${packed}</diagram></mxfile>`)).toContain('- Servizio ordini Node.js')
  })

  it('SVG: titolo ed etichette (anche spezzate in tspan)', () => {
    const t = svgText('<svg><title>Mappa di rete</title><text x="1"><tspan>DMZ</tspan> <tspan>firewall</tspan></text><text>VPN</text></svg>')
    expect(t.split('\n')).toEqual(['Mappa di rete', '- DMZ firewall', '- VPN'])
  })

  it('Mermaid e PlantUML si leggono come testo; i diagrammi sono formati supportati', async () => {
    const dir = tmpHome('diagrams')
    const mmd = path.join(dir, 'flusso.mmd')
    fs.writeFileSync(mmd, 'graph LR\n  Gateway --> Ordini')
    const drawio = path.join(dir, 'rete.drawio')
    fs.writeFileSync(drawio, `<mxfile><diagram name="Rete">${MODEL}</diagram></mxfile>`)
    expect(await extractText(mmd)).toContain('Gateway --> Ordini')
    expect(await extractText(drawio)).toMatch(/^DIAGRAMMA \(draw\.io\)\nPagina: Rete/)
    for (const f of ['a.drawio', 'b.svg', 'c.puml', 'd.plantuml', 'e.mmd', 'f.mermaid']) expect(isSupported(f)).toBe(true)
  })
})

describe('pipeline: suggerimenti e cartelle di Radici', () => {
  const longTech = 'Il gestionale ordini è organizzato a eventi: ogni servizio pubblica eventi di dominio sul bus. '.repeat(6)

  /** Pipeline con callback che registrano suggerimenti e promozioni. */
  const make = (rootFolders: string[] = []) => {
    const store = new PrivateStore(':memory:')
    const suggested: { id: string, category: RootCategory }[] = []
    const promoted: { id: string, category: RootCategory }[] = []
    let n = 0
    const p = new IngestPipeline({
      store,
      llm: new LlmRunner(new FakeAdapter(), store, { dailyBudget: () => 100 }),
      models: () => ({ classify: 'haiku', distill: 'sonnet' }),
      publish: async () => ({ id: `id-${++n}`, duplicate: false }),
      rules: async () => mergeRules([]),
      blockedPaths: async () => mergeBlockedPaths([]),
      language: async () => 'it',
      suggestRoot: (id, category) => suggested.push({ id, category }),
      promoteRoot: async (id, category) => { promoted.push({ id, category }) },
      rootFolder: (folder) => rootFolders.includes(folder),
      log: () => {}
    })
    return { p, suggested, promoted }
  }

  it('sessione: il distillatore suggerisce, non promuove', async () => {
    const { p, suggested, promoted } = make()
    const transcriptPath = writeTranscript(tmpHome('tr'), 's1', [
      { user: 'Spieghiamo l\'architettura del gestionale. ' + longTech },
      { assistant: 'LEZIONE: Architettura a eventi del gestionale | Ogni servizio pubblica eventi. | rif: radice=architecture\nLEZIONE: Timeout del bus in locale | Riavviare il container.' }
    ])
    p.enqueueSession({ sessionId: 's1', transcriptPath, cwd: tmpHome('cwd') })
    await p.tick()
    expect(suggested).toEqual([{ id: 'id-1', category: 'architecture' }])
    expect(promoted).toEqual([])
  })

  it('documento di una cartella "di Radici": promozione diretta (categoria del modello o "other")', async () => {
    const folder = tmpHome('architettura')
    const { p, suggested, promoted } = make([folder])
    const file = path.join(folder, 'rete.md')
    fs.writeFileSync(file, longTech + '\nLEZIONE: Mappa di rete di produzione | DMZ, gateway e servizi interni. | rif: radice=network\nLEZIONE: Glossario | Termini del dominio ordini.')
    p.enqueueDocument({ path: file, folder, hash: await hashFile(file), size: fs.statSync(file).size })
    await p.tick()
    expect(promoted).toEqual([{ id: 'id-1', category: 'network' }, { id: 'id-2', category: 'other' }])
    expect(suggested).toEqual([])
  })

  it('documento di una cartella normale: solo il suggerimento', async () => {
    const folder = tmpHome('documenti')
    const { p, suggested, promoted } = make()
    const file = path.join(folder, 'note.md')
    fs.writeFileSync(file, longTech + '\nLEZIONE: Policy dei segreti | Mai nei repository. | rif: radice=policy')
    p.enqueueDocument({ path: file, folder, hash: await hashFile(file), size: fs.statSync(file).size })
    await p.tick()
    expect(promoted).toEqual([])
    expect(suggested).toEqual([{ id: 'id-1', category: 'policy' }])
  })
})
