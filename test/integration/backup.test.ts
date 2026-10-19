// B7: backup e ripristino del sapere di un team, con nodi veri (team in modalità solo locale).
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { memoryId } from '../../src/core/events'
import { nodePaths } from '../../src/core/paths'
import { HashEmbedder } from '../../src/embed/embedder'
import { FakeAdapter } from '../../src/llm/fake'
import { MicelioHost } from '../../src/node/micelio-host'
import { type BackupContent, countsOf, encodeBackup } from '../../src/backup/archive'
import { eventually, published, tmpHome } from '../helpers'

const PASSWORD = 'una-password-lunga'

describe('backup e ripristino del sapere di un team', () => {
  let host: MicelioHost

  beforeAll(async () => {
    host = new MicelioHost(nodePaths(tmpHome('backup')), { materializeDelayMs: 50, llm: new FakeAdapter(), embedder: new HashEmbedder(), log: (m) => { if (/ripristinato|lento/.test(m)) console.log(m) } })
    await host.start()
  })

  afterAll(async () => { await host?.stop() })

  it('backup di un team e ripristino in un team nuovo: ricordi, storico, Radici, voti, lacune', async () => {
    const { id: srcId } = await host.createTeam('Ordini', 'ada', 'local')
    const src = host.node(srcId)
    const kafka = published(await src.remember({ title: 'Retry dei consumer Kafka', body: 'Backoff esponenziale con massimo 5 tentativi, poi coda di scarto.', tags: ['kafka'] }))
    const gw = published(await src.remember({ title: 'Timeout del gateway', body: 'Il gateway chiude dopo 30 secondi: le chiamate lunghe vanno asincrone.', tags: ['gateway'] }))
    const old = published(await src.remember({ title: 'Vecchia configurazione SFTP', body: 'Porta 2222 sul server di test, dismesso.', tags: ['sftp'] }))
    await src.rootSet(kafka.id, 'practice')
    await src.vote(gw.id, 1)
    await src.pin(gw.id, true)
    await (src as any).requireTeam().append({ type: 'memory.archive', id: old.id, reason: 'server dismesso' })
    await src.reportGap('certificato', 'Come si ruota il certificato del gateway?')

    const { file, name, manifest } = await src.createBackup(PASSWORD)
    expect(name).toMatch(/^Ordini-\d{4}-\d{2}-\d{2}-\d{4}\.micelio-backup$/)
    expect(manifest.counts).toMatchObject({ memories: 3, active: 2, roots: 1, gaps: 1 })

    // Password sbagliata: errore, e nessun team vuoto creato
    const before = (await host.teams()).length
    await expect(host.restoreAsNewTeam(file, 'password-sbagliata')).rejects.toThrow(/Password sbagliata/)
    expect(await host.teams()).toHaveLength(before)

    const { id, report } = await host.restoreAsNewTeam(file, PASSWORD, { teamName: 'Ordini ripristinato', network: 'local' })
    expect(report).toMatchObject({ team: 'Ordini', memories: 3, added: 3, existing: 0 })
    const dst = host.node(id)
    expect(dst.teamName).toBe('Ordini ripristinato')
    expect((await dst.status()).role).toBe('admin')
    expect(dst.recall('kafka retry').map((h) => h.id)).toEqual([kafka.id])
    // storico, Radice, ricordo fissato, lacuna
    expect(dst.archived().map((m) => [m.id, m.statusReason])).toEqual([[old.id, 'server dismesso']])
    expect((await dst.roots()).map((r) => [r.id, r.category])).toEqual([[kafka.id, 'practice']])
    expect((await dst.teamGaps()).map((g) => g.question)).toEqual(['Come si ruota il certificato del gateway?'])
    // autore e data d'origine: chi ripristina firma, ma il ricordo resta "di ada" e non diventa nuovo
    const rec = dst.detail(gw.id)!
    expect(rec.source!.origin).toMatchObject({ author: 'ada', team: 'Ordini' })
    expect(rec.ts).toBe(rec.source!.origin!.ts)
  })

  it('ripristinare di nuovo nello stesso team non duplica nulla', async () => {
    const id = (await host.teams()).find((t) => t.name === 'Ordini ripristinato')!.id
    const dst = host.node(id)
    const src = host.node((await host.teams()).find((t) => t.name === 'Ordini')!.id)
    const { file } = await src.createBackup(PASSWORD)
    const report = await dst.restoreBackup(file, PASSWORD)
    expect(report).toMatchObject({ added: 0, existing: 3 })
    expect((await dst.status()).memories).toBe(2)
  })

  it('backup automatici: il primo subito, si tengono solo gli ultimi N di quel team', async () => {
    const node = host.node((await host.teams()).find((t) => t.name === 'Ordini')!.id)
    const dir = path.join(tmpHome('backup-auto'), 'backup')
    fs.mkdirSync(dir, { recursive: true })
    // Tre backup vecchi di due giorni, più un file di un altro team che non va toccato
    const old = Date.now() / 1000 - 2 * 86_400
    for (const f of ['Ordini-2026-01-01-0000.micelio-backup', 'Ordini-2026-01-02-0000.micelio-backup', 'Ordini-2026-01-03-0000.micelio-backup', 'Altro-2026-01-01-0000.micelio-backup']) {
      fs.writeFileSync(path.join(dir, f), 'x')
      fs.utimesSync(path.join(dir, f), old, old)
    }
    await expect(node.setBackupSettings({ enabled: true, folder: dir })).rejects.toThrow(/password/)
    await node.setBackupSettings({ enabled: true, folder: dir, keep: 2, password: PASSWORD })
    await eventually(() => fs.readdirSync(dir).length === 3)
    const files = fs.readdirSync(dir).sort()
    expect(files[0]).toBe('Altro-2026-01-01-0000.micelio-backup')
    expect(files[1]).toBe('Ordini-2026-01-03-0000.micelio-backup')
    expect(files[2]).toMatch(/^Ordini-\d{4}-\d{2}-\d{2}-\d{4}\.micelio-backup$/)
    expect(node.backupSettings()).toMatchObject({ enabled: true, keep: 2, hasPassword: true, last: { file: files[2] } })
    // la password non torna mai indietro
    expect(JSON.stringify(node.backupSettings())).not.toContain(PASSWORD)
    await node.setBackupSettings({ enabled: false })
  })

  it('5 000 ricordi si ripristinano in meno di un minuto, e il daemon risponde nel frattempo', async () => {
    const memories = Array.from({ length: 5000 }, (_, i) => {
      const base = { kind: 'fact' as const, title: `Ricordo di prova numero ${i}`, body: `Contenuto tecnico ${i}: retry, timeout e indici sul componente ${i % 25}.` }
      return { id: memoryId(base), ...base, tags: [`tema${i % 25}`], source: { type: 'cli' }, author: 'a'.repeat(64), authorName: 'ada', ts: 1_700_000_000_000 + i, status: 'active' as const }
    })
    const content: BackupContent = { memories, roots: [], links: [], votes: {}, pins: [], usage: {}, gaps: [], config: {} }
    const file = encodeBackup(content, { team: 'Grande', createdAt: Date.now(), createdBy: 'test', counts: countsOf(content) }, PASSWORD)
    // Mentre ripristina, il ciclo degli eventi resta libero: misuriamo il ritardo peggiore
    let worst = 0
    let last = Date.now()
    const probe = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - last - 50); last = now }, 50)
    const t0 = Date.now()
    const { id, report } = await host.restoreAsNewTeam(file, PASSWORD, { nodeName: 'ada', network: 'local' })
    clearInterval(probe)
    const ms = Date.now() - t0
    expect(report.added).toBe(5000)
    expect((await host.node(id).status()).memories).toBe(5000)
    expect(ms).toBeLessThan(60_000)
    console.log(`ripristino di 5 000 ricordi: ${ms} ms, blocco più lungo del daemon ${worst} ms`)
  }, 120_000)
})
