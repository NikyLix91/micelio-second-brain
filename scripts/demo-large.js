#!/usr/bin/env node
/**
 * @file Team dimostrativo GRANDE: un nodo con migliaia di ricordi su 25 argomenti, per vedere le
 * galassie (Nucleo e Mappa 2D) e misurare le prestazioni a scala. I ricordi sono INVENTATI e
 * generati in modo deterministico (stesso numero → stessi ricordi).
 *
 * Uso:   npm run build && npm run demo:grande [-- <quanti>]      (default 3000)
 * Poi:   MICELIO_HOME=.demo/grande npm run desktop
 *        (oppure `node dist/cli/main.js --home .demo/grande ui` per il browser)
 * Per fermarlo:  node dist/cli/main.js --home .demo/grande stop
 *
 * Come funziona:
 * - home separata in .demo/grande, porta 7410: il proprio nodo reale non viene toccato;
 * - LLM finto ed embedding "hash" (nessuna chiamata a Claude, nessun modello da scaricare): le
 *   variabili d'ambiente valgono per il daemon avviato da qui, che resta acceso in background;
 * - team in modalità solo locale (nessuna rete); "aggiornare invece di aggiungere" spento, così
 *   ogni ricordo inviato diventa un ricordo;
 * - un secondo avvio riparte dai dati esistenti e aggiunge solo i ricordi mancanti.
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const CLI = path.join(ROOT, 'dist', 'cli', 'main.js')
const HOME = path.join(ROOT, '.demo', 'grande')
const PORT = 7410
const TARGET = Number(process.argv[2] ?? 3000)
/** Richieste in parallelo durante il caricamento. */
const CONCURRENCY = 4

// Daemon con LLM finto ed embedding senza modello (ereditati dal processo avviato da `start`)
const env = { ...process.env, MICELIO_LLM_ADAPTER: 'fake', MICELIO_EMBEDDER: 'hash' }
const cli = (...args) => execFileSync(process.execPath, [CLI, '--home', HOME, ...args], { env, encoding: 'utf8' }).trim()

const topics = ['kafka', 'postgres', 'angular', 'react', 'docker', 'kubernetes', 'terraform', 'oauth', 'gateway', 'ordini',
  'pagamenti', 'fatture', 'magazzino', 'ci', 'test', 'logging', 'tracing', 'cache', 'redis', 'sftp', 'pdf', 'email', 'report', 'etl', 'airflow']
const verbs = ['Retry', 'Timeout', 'Configurazione', 'Migrazione', 'Errore', 'Prestazioni', 'Sicurezza', 'Deploy', 'Monitoraggio', 'Rollback', 'Indice', 'Limite']
const kinds = ['fact', 'howto', 'decision', 'gotcha', 'snippet', 'reference']

/** Ricordo numero i: deterministico, un argomento principale e a volte un secondo (ponti fra galassie). */
function memory (i) {
  let seed = 42 + i * 7919
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const t = pick(topics)
  const t2 = rnd() < 0.25 ? pick(topics) : null
  const v = pick(verbs)
  return {
    title: `${v} ${t}${t2 ? ' con ' + t2 : ''} n.${i}`,
    body: `${v} nel componente ${t}${t2 ? ' quando interagisce con ' + t2 : ''}: dettaglio tecnico numero ${i}, verificato in produzione con log e metriche.`,
    kind: pick(kinds),
    tags: [t, ...(t2 && t2 !== t ? [t2] : []), ...(rnd() < 0.3 ? [pick(verbs).toLowerCase()] : [])]
  }
}

;(async () => {
  if (!fs.existsSync(CLI)) throw new Error('manca dist/: esegui prima `npm run build`')
  fs.mkdirSync(HOME, { recursive: true })
  const cfgPath = path.join(HOME, 'config.json')
  if (!fs.existsSync(cfgPath)) {
    // Budget giornaliero dell'LLM alto: con quello normale (300) le scritture in più andrebbero in Inbox
    fs.writeFileSync(cfgPath, JSON.stringify({ port: PORT, llm: { dailyBudget: 1_000_000 } }, null, 2))
  }
  console.log(cli('start').split('\n').pop())
  const teams = cli('teams', 'list')
  if (!/Grande/.test(teams)) {
    console.log(cli('init', 'Grande', '--name', 'ada', '--solo').split('\n').pop())
    console.log(cli('team', 'config', 'memory.updateOnWrite', 'false').split('\n').pop())
  }
  const { token } = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  const base = `http://127.0.0.1:${PORT}`
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

  // Riparte da dove era arrivato (file accanto alla home)
  const markPath = path.join(HOME, 'demo-seeded.txt')
  let from = fs.existsSync(markPath) ? Number(fs.readFileSync(markPath, 'utf8')) : 0
  if (from >= TARGET) console.log(`già ${from} ricordi`)
  const t0 = Date.now()
  while (from < TARGET) {
    const batch = Array.from({ length: Math.min(CONCURRENCY, TARGET - from) }, (_, k) => from + k)
    await Promise.all(batch.map((i) => fetch(`${base}/api/memories`, { method: 'POST', headers, body: JSON.stringify(memory(i)) })))
    from += batch.length
    fs.writeFileSync(markPath, String(from))
    if (from % 250 < CONCURRENCY) console.log(`${from} / ${TARGET} ricordi (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
  }
  console.log(`\nPronto. Apri l'app sul team demo:\n  MICELIO_HOME=.demo/grande npm run desktop\noppure nel browser:\n  node dist/cli/main.js --home .demo/grande ui\nPer fermarlo:\n  node dist/cli/main.js --home .demo/grande stop`)
})().catch((err) => { console.error(err.message); process.exit(1) })
