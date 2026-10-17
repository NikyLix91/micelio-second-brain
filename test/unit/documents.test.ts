/** Regole sui percorsi (src/privacy/paths.ts) ed estrazione/suddivisione del testo (src/ingest/extract.ts). */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { chunkText, extractText, isSupported } from '../../src/ingest/extract'
import { globToRegExp, isBlockedPath, mergeBlockedPaths } from '../../src/privacy/paths'
import { tmpHome } from '../helpers'

describe('percorsi bloccati', () => {
  it('blocca le cartelle sensibili a qualunque profondità, senza distinguere le maiuscole', () => {
    expect(isBlockedPath('HR/valutazione.docx')).toBe('**/hr/**')
    expect(isBlockedPath('Progetti\\Contratti\\cliente.pdf')).toBe('**/contratti/**')
    expect(isBlockedPath('a/b/Buste Paga/2026/gennaio.pdf')).toBe('**/buste paga/**')
  })

  it('non blocca percorsi tecnici, anche con parole simili', () => {
    expect(isBlockedPath('architettura/hrm-sync.md')).toBeNull() // "hrm-sync" non è la cartella "hr"
    expect(isBlockedPath('docs/procedure/rilascio.docx')).toBeNull()
  })

  it('i pattern del team si aggiungono ai default', () => {
    const p = mergeBlockedPaths(['**/clienti/acme/**', 3])
    expect(isBlockedPath('x/clienti/acme/offerta.docx', p)).toBe('**/clienti/acme/**')
  })

  it('sintassi dei glob', () => {
    expect(globToRegExp('*.md').test('note.md')).toBe(true)
    expect(globToRegExp('*.md').test('a/note.md')).toBe(false) // * non attraversa le cartelle
    expect(globToRegExp('**/x/**').test('/a/b/x/c.txt')).toBe(true)
    expect(globToRegExp('file?.txt').test('file1.txt')).toBe(true)
  })
})

describe('estrazione e suddivisione', () => {
  it('riconosce i formati supportati e ignora i file di blocco di Office', () => {
    expect(isSupported('relazione.DOCX')).toBe(true)
    expect(isSupported('~$relazione.docx')).toBe(false)
    expect(isSupported('foto.png')).toBe(false)
  })

  it('legge Markdown e DOCX veri', async () => {
    const dir = tmpHome('extract')
    const md = path.join(dir, 'nota.md')
    fs.writeFileSync(md, '# Titolo\n\nProcedura di **rilascio**.')
    expect(await extractText(md)).toContain('Procedura di **rilascio**')
    const { OfficeConverter } = require('officeparser')
    const out = await OfficeConverter.convert(md, 'docx')
    const docx = path.join(dir, 'nota.docx')
    fs.writeFileSync(docx, Buffer.from(out.value))
    expect(await extractText(docx)).toContain('Procedura di rilascio')
  })

  it('divide i testi lunghi fra paragrafi, entro il limite di parti', () => {
    const para = 'x'.repeat(300)
    const text = Array.from({ length: 40 }, () => para).join('\n\n')
    const chunks = chunkText(text, 1000, 5)
    expect(chunks.length).toBe(5)
    expect(chunks.every((c) => c.length <= 1000)).toBe(true)
    expect(chunks[0].endsWith('x')).toBe(true) // taglio su un confine di paragrafo
    expect(chunkText('breve', 1000)).toEqual(['breve'])
  })
})
