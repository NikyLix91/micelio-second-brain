// Più team sulla stessa macchina (B3): migrazione dalla struttura a un team, sapere separato,
// instradamento per cartella, identità personale comune, uscita da un team.
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadIdentity } from '../../src/core/identity'
import { hostFiles, nodePaths, teamPaths } from '../../src/core/paths'
import { HashEmbedder } from '../../src/embed/embedder'
import { FakeAdapter } from '../../src/llm/fake'
import { canonicalPath, loadConfig, readConfigFile } from '../../src/node/config'
import { MicelioHost } from '../../src/node/micelio-host'
import { eventually, localDht, makeNode, published, tmpHome } from '../helpers'

describe('più team sullo stesso PC', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  const home = tmpHome('multi')
  const root = nodePaths(home)
  const work = tmpHome('multi-work')
  const clientX = path.join(work, 'clienteX')
  let host: MicelioHost
  let teamA = ''
  let teamB = ''

  const newHost = () => new MicelioHost(root, {
    bootstrap: dht.bootstrap,
    materializeDelayMs: 50,
    llm: new FakeAdapter(),
    embedder: new HashEmbedder(),
    log: process.env.MICELIO_TEST_LOG ? (m) => console.log(`[host] ${m}`) : undefined
  })

  beforeAll(async () => {
    dht = await localDht()
    fs.mkdirSync(clientX, { recursive: true })
    // Un nodo "vecchio" (prima di B3): tutto nella home, cartella di lavoro abilitata in config.json
    const { node } = makeNode('legacy', dht.bootstrap, home)
    await node.start()
    await node.init('Alfa', 'ada')
    node.watchAdd(work)
    published(await node.remember({ title: 'Deploy di Alfa', body: 'Il deploy di Alfa passa dalla pipeline blu.', tags: ['deploy'] }))
    await node.stop()
  })

  afterAll(async () => {
    await host?.stop()
    await dht?.destroy()
    fs.rmSync(work, { recursive: true, force: true })
  })

  it('migra il team esistente in teams/<id> senza perdere nulla', async () => {
    host = newHost()
    await host.start()
    const teams = await host.teams()
    expect(teams).toHaveLength(1)
    teamA = teams[0].id
    expect(teams[0]).toMatchObject({ name: 'Alfa', nodeName: 'ada', isDefault: true, memories: 1 })
    // i file del team non stanno più nella home…
    expect(fs.existsSync(path.join(home, 'state.json'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'corestore'))).toBe(false)
    expect(fs.existsSync(teamPaths(root, teamA).state)).toBe(true)
    // …le cartelle abilitate passano nelle impostazioni del team, config.json resta della macchina
    expect(readConfigFile(root.config).watch).toBeUndefined()
    expect(loadConfig(teamPaths(root, teamA)).watch.sessions).toEqual([canonicalPath(work)])
    expect(loadConfig(root).defaultTeam).toBe(teamA)
    // il nome del nodo diventa quello dell'identità personale, e l'identità si lega al team
    const identity = loadIdentity(hostFiles(root).identity)
    expect(identity?.name).toBe('ada')
    const me = (await host.node().members()).find((m) => m.name === 'ada')
    expect(me?.person).toBe(identity?.publicKey)
  })

  it('un secondo team ha sapere separato e la stessa identità personale', async () => {
    const { id, status } = await host.createTeam('Beta') // nome dall'identità
    teamB = id
    expect(status.nodeName).toBe('ada')
    published(await host.node('Beta').remember({ title: 'Regola di Beta', body: 'In Beta le release si fanno il giovedì.', tags: ['release'] }))
    // la ricerca di un team non vede i ricordi dell'altro
    expect(host.node('Alfa').recall('release giovedì')).toHaveLength(0)
    expect(host.node('Beta').recall('pipeline blu')).toHaveLength(0)
    expect(host.node(teamB).recall('release')).toHaveLength(1)
    // senza indicazione si usa il predefinito (Alfa); si può cambiare
    expect(host.node().teamName).toBe('Alfa')
    await host.setDefault('beta')
    expect(host.node().teamName).toBe('Beta')
    // stessa persona in entrambi i team, con feed (chiavi del nodo) diversi
    await eventually(async () => !!(await host.node(teamB).members())[0]?.person, [host.node(teamB)])
    const [a] = await host.node(teamA).members()
    const [b] = await host.node(teamB).members()
    expect(b.person).toBe(a.person)
    expect(b.key).not.toBe(a.key)
    expect(() => host.node('Gamma')).toThrow(/Nessun team/)
  })

  it('le sessioni vanno al team della cartella più specifica; una cartella appartiene a un solo team', () => {
    host.node(teamB).watchAdd(clientX)
    expect(host.ownerOf(path.join(clientX, 'src'))).toBe(teamB)
    expect(host.ownerOf(path.join(work, 'altro'))).toBe(teamA)
    expect(host.ownerOf(home)).toBeNull()
    // stessa cartella in due team: rifiutata
    expect(() => host.node(teamA).watchAdd(clientX)).toThrow(/già abilitata nel team "Beta"/)
    // documenti annidati fra team: rifiutati (lo stesso file finirebbe in due team)
    return Promise.all([
      expect(host.node(teamA).documentsAdd(work, false)).resolves.toBeTruthy(),
      expect(host.node(teamB).documentsAdd(clientX, false)).rejects.toThrow(/già sorvegliata dal team "Alfa"/)
    ])
  })

  it('la fine sessione è instradata al team giusto, o ignorata', async () => {
    const r = await host.ingestSession({ sessionId: 's-1', transcriptPath: path.join(clientX, 'nessuno.jsonl'), cwd: clientX })
    expect(r).toMatchObject({ queued: true, team: teamB })
    expect((await host.ingestSession({ sessionId: 's-2', transcriptPath: 'x', cwd: home })).queued).toBe(false)
  })

  it('al riavvio ritrova entrambi i team e il predefinito', async () => {
    await host.stop()
    host = newHost()
    await host.start()
    expect((await host.teams()).map((t) => [t.name, t.isDefault])).toEqual([['Alfa', false], ['Beta', true]])
  })

  it('togliere un team cancella solo i suoi dati locali', async () => {
    const left = await host.leaveTeam('Beta')
    expect(left.map((t) => t.name)).toEqual(['Alfa'])
    expect(fs.existsSync(path.join(hostFiles(root).teams, teamB))).toBe(false)
    // il predefinito torna al primo team rimasto
    expect(host.node().teamName).toBe('Alfa')
    expect(host.node().recall('pipeline blu')).toHaveLength(1)
  })
})
