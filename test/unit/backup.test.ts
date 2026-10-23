// B7: backup del sapere di un team. Formato e cifratura del file, piano degli eventi di ripristino.
// EN: B7: backup of a team's knowledge. File format and encryption, plan of the restore events.
import { describe, expect, it } from 'vitest'
import { memoryId, TeamEvent } from '../../src/core/events'
import { type BackupContent, type BackupMemory, backupFileName, countsOf, decodeBackup, encodeBackup, readManifest } from '../../src/backup/archive'
import { planRestore } from '../../src/backup/restore-plan'

const A = 'a'.repeat(64)

/** Ricordo di prova con id coerente con il contenuto. / EN: Test memory with an id consistent with its content. */
function mem (title: string, extra: Partial<BackupMemory> = {}): BackupMemory {
  const base = { kind: 'fact' as const, title, body: `Corpo di ${title}` }
  return { id: memoryId(base), ...base, tags: ['prova'], source: { type: 'cli' }, author: A, authorName: 'ada', ts: 1_700_000_000_000, status: 'active', ...extra }
}

function content (memories: BackupMemory[], extra: Partial<BackupContent> = {}): BackupContent {
  return { memories, roots: [], links: [], votes: {}, pins: [], usage: {}, gaps: [], config: {}, ...extra }
}

const manifest = (c: BackupContent) => ({ team: 'Ordini', createdAt: 1, createdBy: 'pc-ada', counts: countsOf(c) })

describe('file di backup', () => {
  const c = content([mem('Retry di Kafka'), mem('Indice su ordini', { status: 'archived', statusReason: 'vecchio' })])

  it('si cifra e si decifra con la password; il manifesto si legge anche senza', () => {
    const file = encodeBackup(c, manifest(c), 'password-lunga')
    expect(file.toString()).not.toContain('Retry di Kafka') // contenuto cifrato / EN: encrypted content
    expect(readManifest(file)).toMatchObject({ team: 'Ordini', counts: { memories: 2, active: 1 } })
    const out = decodeBackup(file, 'password-lunga')
    expect(out.content).toEqual(c)
  })

  it('password sbagliata, file alterato o manifesto cambiato: nessun contenuto', () => {
    const file = encodeBackup(c, manifest(c), 'password-lunga')
    expect(() => decodeBackup(file, 'altra-password')).toThrow(/Password sbagliata/)
    // manifesto modificato (es. nome del team): è autenticato, quindi il file non si apre più
    // EN: changed manifest (e.g. team name): it is authenticated, so the file no longer opens
    const f = JSON.parse(file.toString())
    f.manifest.team = 'Altro'
    expect(() => decodeBackup(Buffer.from(JSON.stringify(f)), 'password-lunga')).toThrow(/Password sbagliata/)
  })

  it('password troppo corta, file che non è un backup, versione futura', () => {
    expect(() => encodeBackup(c, manifest(c), 'corta')).toThrow(/almeno 8/)
    expect(() => readManifest(Buffer.from('ciao'))).toThrow(/non è un backup/)
    const f = JSON.parse(encodeBackup(c, manifest(c), 'password-lunga').toString())
    f.version = 99
    expect(() => readManifest(Buffer.from(JSON.stringify(f)))).toThrow(/più recente/)
  })

  it('nome del file: team senza caratteri problematici e data', () => {
    expect(backupFileName('Acme - Team Web', new Date(2026, 9, 19, 8, 5))).toBe('Acme-Team-Web-2026-10-19-0805.micelio-backup')
  })
})

describe('piano di ripristino', () => {
  it('ricordi con autore e data d\'origine, poi storico, Radici, collegamenti, voti, uso, lacune', () => {
    const a = mem('Retry di Kafka')
    const b = mem('Timeout del gateway')
    const old1 = mem('Retry vecchio 1')
    const old2 = mem('Retry vecchio 2')
    const arch = mem('Configurazione dismessa', { status: 'archived', statusReason: 'obsoleto' })
    const red = mem('Segreto', { status: 'redacted' })
    const c = content([a, b, { ...old1, status: 'superseded', supersededBy: a.id, statusReason: 'fusione' }, { ...old2, status: 'superseded', supersededBy: a.id }, arch, red], {
      roots: [{ id: a.id, category: 'practice', by: A, ts: 1, reviewedAt: 1, reviewedBy: A, status: 'review', flags: [{ reason: 'codice cambiato', refs: ['abc1234'], by: A, ts: 2 }] }],
      links: [{ from: a.id, to: b.id, rel: 'refines' }, { from: a.id, to: red.id, rel: 'relates' }],
      votes: { [a.id]: 3, [b.id]: -2 },
      pins: [b.id],
      usage: { [a.id]: { count: 7, last: 5 } },
      gaps: [{ id: 'f'.repeat(64), question: 'Come si ruota il certificato?', by: A, ts: 1, askers: [A], status: 'closed', memory: b.id }],
      config: { 'memory.language': 'it' }
    })
    const ev = planRestore(c, { sourceTeam: 'Ordini' })
    // ogni evento è valido per lo schema del log
    // EN: every event is valid for the log schema
    for (const e of ev) expect(TeamEvent.safeParse({ ...e, v: 1, ts: 1 }).success).toBe(true)
    const types = ev.map((e) => e.type)
    expect(types[0]).toBe('team.config')
    // il redatto non torna; gli altri 5 sì, con l'origine
    // EN: the redacted one does not come back; the other 5 do, with their origin
    const adds = ev.filter((e) => e.type === 'memory.add')
    expect(adds).toHaveLength(5)
    expect(adds[0]).toMatchObject({ memory: { title: 'Retry di Kafka', source: { type: 'cli', origin: { author: 'ada', key: A, ts: 1_700_000_000_000, team: 'Ordini' } } } })
    // i due sostituiti in UN supersede verso il successore, PRIMA di Radici e ricordi fissati
    // EN: the two replaced ones in ONE supersede to the successor, BEFORE Roots and pinned memories
    const sup = ev.filter((e) => e.type === 'memory.supersede')
    expect(sup).toEqual([expect.objectContaining({ old: [old1.id, old2.id], reason: 'fusione' })])
    expect(types.indexOf('memory.supersede')).toBeLessThan(types.indexOf('root.set'))
    expect(types.indexOf('memory.archive')).toBeLessThan(types.indexOf('memory.pin'))
    expect(ev).toContainEqual({ type: 'root.flag', id: a.id, reason: 'codice cambiato', refs: ['abc1234'] })
    // collegamento verso il redatto scartato; voti con il segno della somma
    // EN: link to the redacted one dropped; votes with the sign of the sum
    expect(ev.filter((e) => e.type === 'memory.link')).toHaveLength(1)
    expect(ev).toContainEqual({ type: 'memory.vote', id: b.id, delta: -1 })
    expect(ev).toContainEqual({ type: 'usage.report', counts: { [a.id]: { count: 7, last: 5 } } })
    expect(ev.slice(-2)).toEqual([{ type: 'gap.report', id: 'f'.repeat(64), question: 'Come si ruota il certificato?' }, { type: 'gap.close', id: 'f'.repeat(64), memory: b.id }])
  })

  it('in un team esistente la configurazione non si tocca; un\'origine già presente resta la prima', () => {
    const first = { author: 'bruno', key: 'b'.repeat(64), ts: 1, team: 'Primo' }
    const c = content([mem('Ricordo già ripristinato', { source: { type: 'cli', origin: first } })], { config: { 'memory.language': 'en' } })
    const ev = planRestore(c, { includeConfig: false, sourceTeam: 'Secondo' })
    expect(ev.some((e) => e.type === 'team.config')).toBe(false)
    expect(ev[0]).toMatchObject({ memory: { source: { origin: first } } })
  })
})
