#!/usr/bin/env node
/**
 * @file Team dimostrativo: 3 nodi Micelio locali (alice, bruno, carla) con ~50 ricordi tecnici
 * verosimili e INVENTATI, per provare UI e app desktop senza toccare il proprio nodo reale.
 *
 * Uso:   npm run build && npm run demo
 * Poi, in un altro terminale:   MICELIO_HOME=.demo/alice npm run desktop
 * (oppure `micelio --home .demo/alice ui` per il browser). Ctrl+C ferma il team demo.
 *
 * Come funziona:
 * - una DHT privata in-process (hyperdht/testnet): i nodi demo non escono su internet;
 * - 3 daemon reali (`micelio daemon`) come processi figli, ognuno con la sua home in .demo/
 *   e la sua porta (7401-7403), con LLM finto (nessuna chiamata a Claude);
 * - alice crea il team, bruno e carla entrano con un invito, poi ognuno scrive i suoi ricordi.
 * Le home restano in .demo/: un secondo avvio riparte dai dati esistenti.
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const CLI = path.join(ROOT, 'dist', 'cli', 'main.js')
const DEMO = path.join(ROOT, '.demo')
const NODES = [
  { name: 'alice', port: 7401 },
  { name: 'bruno', port: 7402 },
  { name: 'carla', port: 7403 }
]

/** [autore, tipo, titolo, corpo, tag] */
const MEMORIES = [
  ['alice', 'gotcha', 'Build Angular in out of memory su Azure DevOps', 'Sugli agent ospitati l’heap di Node è basso: impostare `NODE_OPTIONS=--max-old-space-size=6144` nello step di build.', ['angular', 'ci', 'azure-devops', 'node']],
  ['alice', 'howto', 'Cache delle dipendenze npm nelle pipeline Azure', 'Usare il task Cache con chiave su `package-lock.json`: la build passa da 6 a 2 minuti.', ['ci', 'azure-devops', 'npm', 'performance']],
  ['alice', 'decision', 'Pipeline YAML al posto delle classic release', 'Tutte le nuove pipeline sono YAML versionate nel repo: revisionabili in PR e riproducibili.', ['ci', 'azure-devops', 'git']],
  ['alice', 'gotcha', 'Test Angular instabili con fakeAsync e HttpClient', 'Con `fakeAsync` le richieste di HttpClientTestingModule vanno chiuse con `httpMock.verify()` dopo `flush()`, altrimenti i test passano a caso.', ['angular', 'testing']],
  ['alice', 'howto', 'Lazy loading delle route in Angular 17', 'Usare `loadComponent` con componenti standalone: il bundle iniziale scende del 40%.', ['angular', 'performance']],
  ['alice', 'fact', 'Budget di angular.json bloccano la build in CI', 'Un errore di budget è diverso da un OOM: leggere il log prima di alzare la memoria.', ['angular', 'ci']],
  ['alice', 'snippet', 'Interceptor Angular per il token di Keycloak', 'Interceptor funzionale che aggiunge `Authorization: Bearer` solo verso le API interne, mai verso domini esterni.', ['angular', 'keycloak', 'security']],
  ['alice', 'gotcha', 'Zone.js e librerie di grafici: change detection continua', 'Eseguire le animazioni dei grafici con `ngZone.runOutsideAngular` per evitare cicli di change detection a ogni frame.', ['angular', 'performance']],
  ['alice', 'reference', 'Linee guida per le code review del frontend', 'Checklist: accessibilità, stati di errore, test dei casi limite, niente logica nei template.', ['angular', 'react', 'code-review']],
  ['alice', 'decision', 'React per i nuovi frontend interni', 'I nuovi strumenti interni si fanno in React + Vite; Angular resta sui prodotti esistenti.', ['react', 'angular', 'architettura']],
  ['alice', 'howto', 'TanStack Query per lo stato del server in React', 'Chiavi di query per risorsa e invalidazione mirata dopo le mutazioni: niente stato globale duplicato.', ['react', 'architettura']],
  ['alice', 'gotcha', 'StrictMode di React esegue due volte gli effetti in sviluppo', 'Gli effetti devono essere idempotenti e restituire una funzione di pulizia: in produzione girano una volta sola.', ['react', 'testing']],
  ['alice', 'howto', 'Variabili d’ambiente in Vite', 'Solo le variabili con prefisso `VITE_` arrivano al client: mai mettere segreti lì.', ['react', 'security', 'vite']],
  ['alice', 'fact', 'Le immagini Docker multi-stage dimezzano il peso del frontend', 'Build in `node:22`, servizio in `nginx:alpine`: da 1,1 GB a 45 MB.', ['docker', 'react', 'performance']],
  ['alice', 'gotcha', 'Ordine dei COPY nel Dockerfile e cache dei layer', 'Copiare prima `package*.json` e fare `npm ci`, poi il codice: altrimenti ogni modifica reinstalla tutto.', ['docker', 'npm', 'ci']],
  ['alice', 'howto', 'Debug di un container che si chiude subito', '`docker run -it --entrypoint sh <immagine>` per entrare e lanciare il comando a mano.', ['docker']],

  ['bruno', 'decision', 'Drizzle come ORM per i nuovi servizi Postgres', 'Niente motore binario (problemi con Alpine), query vicine a SQL. Prisma resta sui servizi esistenti.', ['orm', 'drizzle', 'postgres', 'docker']],
  ['bruno', 'gotcha', 'Prisma e immagini Alpine', 'Il motore binario di Prisma ha richiesto `binaryTargets` specifici per musl: fonte di build fallite in CI.', ['orm', 'prisma', 'docker', 'ci']],
  ['bruno', 'howto', 'Migrazioni Drizzle nella pipeline di release', 'Generare con `drizzle-kit generate` in sviluppo, applicare con un job dedicato prima del deploy, mai a mano.', ['drizzle', 'postgres', 'ci']],
  ['bruno', 'gotcha', 'Indice mancante sulle foreign key in Postgres', 'Postgres non crea indici sulle FK: le delete a cascata sulla tabella ordini impiegavano minuti.', ['postgres', 'performance']],
  ['bruno', 'howto', 'EXPLAIN ANALYZE prima di ottimizzare una query', 'Guardare i Seq Scan su tabelle grandi e le stime di righe sbagliate: spesso basta `ANALYZE`.', ['postgres', 'performance']],
  ['bruno', 'decision', 'Connection pooling con PgBouncer in transaction mode', 'I servizi Node aprivano troppe connessioni: PgBouncer davanti a Postgres, pool da 20 per servizio.', ['postgres', 'architettura', 'performance']],
  ['bruno', 'gotcha', 'Prepared statement e PgBouncer in transaction mode', 'Con PgBouncer in transaction mode disattivare i prepared statement nel driver, altrimenti errori casuali.', ['postgres', 'drizzle']],
  ['bruno', 'decision', 'RabbitMQ per gli eventi tra servizi ordini e magazzino', 'Code durevoli, conferma manuale dei messaggi, dead letter queue con massimo 3 tentativi.', ['rabbitmq', 'architettura', 'messaging']],
  ['bruno', 'gotcha', 'Messaggio malformato che blocca un consumer RabbitMQ', 'Il consumer andava in crash e il messaggio tornava in coda all’infinito: risolto con la dead letter queue.', ['rabbitmq', 'messaging', 'incidenti']],
  ['bruno', 'howto', 'Idempotenza dei consumer di messaggi', 'Salvare l’id del messaggio elaborato nella stessa transazione dell’effetto: i duplicati diventano innocui.', ['messaging', 'postgres', 'architettura']],
  ['bruno', 'snippet', 'Retry con backoff esponenziale per le API esterne', '`p-retry` con 5 tentativi, fattore 2, minimo 500 ms; nessun retry sui 4xx tranne 429.', ['node', 'resilienza']],
  ['bruno', 'gotcha', 'Timeout SFTP dopo 30 secondi di inattività', 'Impostare `keepaliveInterval: 10000` in ssh2-sftp-client e riconnettere con backoff.', ['node', 'resilienza', 'integrazioni']],
  ['bruno', 'howto', 'Log strutturati JSON con pino', 'Un logger per richiesta con `requestId`, livelli coerenti, niente dati personali nei log.', ['node', 'osservabilità', 'security']],
  ['bruno', 'decision', 'OpenTelemetry per il tracing dei servizi', 'Tracce esportate verso il collector interno; ogni servizio propaga il contesto via header W3C.', ['osservabilità', 'architettura']],
  ['bruno', 'gotcha', 'Date sfasate di un’ora dopo il cambio dell’ora legale', 'Il container gira in UTC e il job usava l’ora locale: usare sempre fusi espliciti (`Europe/Rome`).', ['node', 'docker', 'incidenti']],
  ['bruno', 'howto', 'Graceful shutdown dei servizi Node in Kubernetes', 'Gestire SIGTERM: smettere di accettare richieste, finire quelle in corso, chiudere pool e consumer.', ['node', 'kubernetes', 'resilienza']],
  ['bruno', 'fact', 'Health check separati: liveness e readiness', 'La readiness controlla le dipendenze (DB, code); la liveness solo che il processo risponda.', ['kubernetes', 'resilienza']],

  ['carla', 'decision', 'Keycloak per il single sign-on', 'Scelto Keycloak al posto di Auth0 per costi e controllo; un realm per ambiente.', ['keycloak', 'security', 'architettura']],
  ['carla', 'howto', 'Flusso PKCE per le applicazioni single page', 'Le SPA usano Authorization Code + PKCE; niente implicit flow, niente segreti nel client.', ['keycloak', 'security', 'react', 'angular']],
  ['carla', 'gotcha', 'Token scaduti e orologi non sincronizzati', 'Una VM con l’orologio avanti di 2 minuti rifiutava token validi: abilitare NTP e una tolleranza di 30 s.', ['keycloak', 'security', 'incidenti']],
  ['carla', 'howto', 'Rotazione dei segreti con Azure Key Vault', 'I servizi leggono i segreti all’avvio dal Key Vault; rotazione trimestrale senza deploy.', ['security', 'azure-devops']],
  ['carla', 'gotcha', 'Token GitHub senza scope write:packages', 'Deploy fallito con 401 sul registry: il token deve avere `write:packages`.', ['git', 'ci', 'security']],
  ['carla', 'decision', 'Trunk-based development con feature flag', 'Branch di vita breve (massimo 2 giorni), merge su main protetto, funzioni incomplete dietro flag.', ['git', 'architettura']],
  ['carla', 'howto', 'Procedura di hotfix in produzione', 'Branch `hotfix/*` da main, PR con un’approvazione, tag di versione che avvia la release, poi merge in develop.', ['git', 'release']],
  ['carla', 'reference', 'Convenzione dei messaggi di commit', 'Conventional Commits (`feat:`, `fix:`…): il changelog si genera da solo a ogni release.', ['git', 'release']],
  ['carla', 'howto', 'Test end-to-end con Playwright in CI', 'Browser installati nell’immagine di CI, tracce salvate solo sui fallimenti, test in parallelo per file.', ['testing', 'ci', 'react']],
  ['carla', 'gotcha', 'Test end-to-end dipendenti dall’ordine', 'Ogni test deve creare i propri dati: un test che usava i dati del precedente falliva solo in parallelo.', ['testing']],
  ['carla', 'decision', 'Copertura minima sui moduli di dominio', 'Soglia dell’80% solo sui moduli di dominio; niente soglia sui file di configurazione e di colla.', ['testing', 'code-review']],
  ['carla', 'howto', 'Scansione delle dipendenze vulnerabili in CI', '`npm audit --omit=dev` blocca la pipeline sulle vulnerabilità alte; eccezioni documentate nel repo.', ['security', 'npm', 'ci']],
  ['carla', 'fact', 'Header di sicurezza HTTP obbligatori', 'CSP, HSTS, X-Content-Type-Options e Referrer-Policy su tutti i frontend pubblici.', ['security', 'react', 'angular']],
  ['carla', 'gotcha', 'CORS troppo permissivo sulle API interne', 'Un `Access-Control-Allow-Origin: *` con credenziali esponeva le API: whitelist esplicita dei domini.', ['security', 'node']],
  ['carla', 'howto', 'Release notes generate dalle PR', 'Etichette sulle PR (feature, fix, breaking) e changelog generato al tag: niente note scritte a mano.', ['release', 'git', 'ci']]
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Chiamata all'API di un nodo demo (il token si legge dalla sua config.json). */
async function call (node, method, route, body) {
  const token = JSON.parse(fs.readFileSync(path.join(node.home, 'config.json'), 'utf8')).token
  const res = await fetch(`http://127.0.0.1:${node.port}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${node.name} ${route}: ${data.error ?? res.status}`)
  return data
}

async function main () {
  if (!fs.existsSync(CLI)) throw new Error('Esegui prima `npm run build`')
  const createTestnet = require('hyperdht/testnet')
  const testnet = await createTestnet(3)
  const bootstrap = testnet.bootstrap.map((b) => `${b.host}:${b.port}`).join(',')
  console.log('DHT privata avviata (i nodi demo non escono su internet)')

  const children = []
  for (const n of NODES) {
    n.home = path.join(DEMO, n.name)
    fs.mkdirSync(n.home, { recursive: true })
    // La porta va salvata in config.json: così anche CLI e app desktop la trovano.
    const cfgFile = path.join(n.home, 'config.json')
    const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {}
    fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, port: n.port, token: cfg.token ?? require('node:crypto').randomBytes(24).toString('hex'), llm: { ...(cfg.llm ?? {}), adapter: 'fake' }, embeddings: { adapter: process.env.MICELIO_DEMO_EMBEDDER ?? 'hash' } }, null, 2))
    const child = spawn(process.execPath, [CLI, 'daemon'], {
      env: { ...process.env, MICELIO_HOME: n.home, MICELIO_DHT_BOOTSTRAP: bootstrap, NO_COLOR: '1' },
      stdio: ['ignore', 'ignore', 'inherit']
    })
    children.push(child)
  }
  const stopAll = async () => {
    for (const c of children) c.kill()
    await testnet.destroy()
    process.exit(0)
  }
  process.on('SIGINT', stopAll)
  process.on('SIGTERM', stopAll)

  // Attende che i daemon rispondano.
  for (const n of NODES) {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://127.0.0.1:${n.port}/api/health`)).ok) break } catch {}
      await sleep(500)
    }
  }

  const [alice, bruno, carla] = NODES
  const status = await call(alice, 'GET', '/api/status')
  if (!status.configured) {
    console.log('Creazione del team "Team Demo"…')
    await call(alice, 'POST', '/api/team/init', { team: 'Team Demo', name: 'alice' })
    for (const n of [bruno, carla]) {
      const { code } = await call(alice, 'POST', '/api/invites')
      await call(n, 'POST', '/api/team/join', { code, name: n.name })
      console.log(`${n.name} è nel team`)
    }
    await call(alice, 'POST', '/api/members/bruno/promote')
    console.log('Scrittura dei ricordi…')
    for (const [author, kind, title, body, tags] of MEMORIES) {
      const node = NODES.find((n) => n.name === author)
      await call(node, 'POST', '/api/memories', { kind, title, body, tags })
    }
    // Cartella di documenti condivisibile di alice (Fase 4): un DOCX vero e un Markdown.
    // Con il LLM finto, ogni riga "LEZIONE: titolo | corpo" diventa un ricordo con la fonte.
    const docs = path.join(DEMO, 'documenti-alice')
    fs.mkdirSync(docs, { recursive: true })
    const md = path.join(DEMO, 'tmp-architettura.md')
    fs.writeFileSync(md, '# Architettura del servizio ordini\n\nLEZIONE: Il servizio ordini pubblica eventi su RabbitMQ | Ogni ordine confermato produce un evento ordine.confermato consumato da magazzino e fatturazione.\n\nLEZIONE: Timeout delle chiamate al magazzino | Le chiamate sincrone al magazzino hanno timeout di 2 secondi e circuit breaker.\n')
    const { OfficeConverter } = require('officeparser')
    fs.writeFileSync(path.join(docs, 'architettura-ordini.docx'), Buffer.from((await OfficeConverter.convert(md, 'docx')).value))
    fs.rmSync(md)
    fs.writeFileSync(path.join(docs, 'runbook-incidenti.md'), '# Runbook incidenti\n\nLEZIONE: Primo passo in un incidente di produzione | Aprire il canale di incidente e nominare un coordinatore prima di intervenire.\n')
    await call(alice, 'POST', '/api/documents/folders', { path: docs, shareable: true })
    // Un caso dubbio in inbox e una decisione privata, per popolare anche quelle schermate.
    await call(alice, 'POST', '/api/memories', { title: 'Proxy aziendale nelle pipeline [incerto]', body: 'Serve HTTPS_PROXY negli step che scaricano pacchetti.', tags: ['ci'] })
    await call(alice, 'POST', '/api/memories', { title: 'Nota per la valutazione di fine anno', body: 'Appunti personali: non devono arrivare al team.' })
  }

  // Attende la convergenza sul nodo di alice.
  for (let i = 0; i < 60; i++) {
    const s = await call(alice, 'GET', '/api/status')
    if (s.memories >= MEMORIES.length + 3) break // + 3 ricordi dai documenti
    await sleep(500)
  }
  const s = await call(alice, 'GET', '/api/status')
  console.log(`\nTeam demo pronto: ${s.members} membri, ${s.memories} ricordi sul nodo di alice.`)
  console.log(`App desktop:   MICELIO_HOME=${path.relative(ROOT, alice.home)} npm run desktop`)
  console.log(`Browser:       node dist/cli/main.js --home ${path.relative(ROOT, alice.home)} ui`)
  console.log('Ctrl+C per fermare il team demo.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
