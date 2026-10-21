import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import createTestnet from 'hyperdht/testnet'
import { nodePaths } from '../src/core/paths'
import { HashEmbedder } from '../src/embed/embedder'
import { FakeAdapter } from '../src/llm/fake'
import type { ExplicitOutcome } from '../src/ingest/pipeline'
import { MicelioNode } from '../src/node/micelio-node'

export function tmpHome (label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `micelio-${label}-`))
}

/** DHT locale in-process: i test non dipendono dalla rete pubblica. / EN: In-process local DHT: tests do not depend on the public network. */
export async function localDht (size = 3): Promise<{ bootstrap: { host: string, port: number }[], destroy: () => Promise<void> }> {
  const testnet = await createTestnet(size)
  return { bootstrap: testnet.bootstrap, destroy: () => testnet.destroy() }
}

export function makeNode (label: string, bootstrap: { host: string, port: number }[], home = tmpHome(label)): { node: MicelioNode, home: string } {
  const verbose = !!process.env.MICELIO_TEST_LOG
  const node = new MicelioNode(nodePaths(home), {
    bootstrap,
    materializeDelayMs: 50,
    // LLM finto e deterministico: i test non consumano l'abbonamento e non dipendono dalla rete.
    // EN: Fake, deterministic LLM: tests do not use the subscription and do not depend on the network.
    llm: new FakeAdapter(),
    // Embedder finto: i test non scaricano il modello (130 MB) e restano deterministici.
    // EN: Fake embedder: tests do not download the model (130 MB) and stay deterministic.
    embedder: new HashEmbedder(),
    log: verbose ? (m) => console.log(`[${label}] ${m}`) : undefined
  })
  return { node, home }
}

/** Attende che `fn` restituisca true, sincronizzando i nodi a ogni giro. / EN: Waits until `fn` returns true, syncing the nodes on every round. */
export async function eventually (fn: () => Promise<boolean> | boolean, nodes: MicelioNode[] = [], timeoutMs = 30_000): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    for (const n of nodes) await n.sync().catch(() => {})
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('condizione non raggiunta entro il timeout')
}

/**
 * Verifica che un salvataggio esplicito sia stato pubblicato nel team e ne restituisce id e
 * flag di duplicato. Se è finito in inbox o in privato il test fallisce con il motivo.
 *
 * EN: Checks that an explicit save was published to the team and returns its id and duplicate
 * flag. If it ended up in the Inbox or in private, the test fails with the reason.
 */
export function published (r: ExplicitOutcome): { id: string, duplicate: boolean } {
  if (r.outcome !== 'team') throw new Error(`atteso "team", ottenuto "${r.outcome}": ${'reason' in r ? r.reason : ''}`)
  return { id: r.id, duplicate: r.duplicate }
}
