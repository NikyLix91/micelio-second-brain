#!/usr/bin/env node
/**
 * @file Punto d'ingresso di `micelio-server`.
 *
 * EN: Entry point of `micelio-server`.
 *
 * Uso:
 *   micelio-server --host <IP pubblico> [--port 49737] [--bind 0.0.0.0] [--extra-nodes 0]
 *
 * EN: Usage:
 *   micelio-server --host <public IP> [--port 49737] [--bind 0.0.0.0] [--extra-nodes 0]
 *
 * Ogni opzione si può dare anche con una variabile d'ambiente (è così che la passa il servizio
 * systemd, da /etc/default/micelio-server): MICELIO_SERVER_HOST, MICELIO_SERVER_PORT,
 * MICELIO_SERVER_BIND, MICELIO_SERVER_EXTRA_NODES. Gli argomenti vincono sulle variabili.
 *
 * EN: Each option can also be given as an environment variable (that's how the systemd service passes it,
 * from /etc/default/micelio-server): MICELIO_SERVER_HOST, MICELIO_SERVER_PORT, MICELIO_SERVER_BIND,
 * MICELIO_SERVER_EXTRA_NODES. Arguments win over variables.
 */
import os from 'node:os'
import { parseArgs } from 'node:util'
import { DEFAULT_PORT, startServer } from './dht-server'

/** Intervallo del messaggio di stato nel log (journalctl -u micelio-server). / EN: Interval of the status message in the log (journalctl -u micelio-server). */
const STATUS_EVERY_MS = 15 * 60 * 1000

/** Messaggio con data e ora: il log di systemd ha già la sua, ma lanciato a mano aiuta. / EN: Message with date and time: the systemd log already has its own, but it helps when started by hand. */
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`)

/**
 * Primo IPv4 non interno della macchina. È l'indirizzo PUBBLICO solo se la macchina ne ha uno
 * diretto; dietro NAT (molte VM cloud e reti aziendali) l'IP pubblico va indicato con --host.
 *
 * EN: First non-internal IPv4 of the machine. It is the PUBLIC address only if the machine has a direct one;
 * behind NAT (many cloud VMs and corporate networks) the public IP must be given with --host.
 */
function guessHost (): string | null {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return null
}

async function main (): Promise<void> {
  const { values } = parseArgs({
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      bind: { type: 'string' },
      'extra-nodes': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    }
  })
  if (values.help) {
    console.log('micelio-server --host <IP pubblico> [--port 49737] [--bind 0.0.0.0] [--extra-nodes 0]\nVedi server/README.md')
    return
  }

  const env = process.env
  let host = values.host ?? env.MICELIO_SERVER_HOST
  if (!host) {
    host = guessHost() ?? undefined
    if (!host) throw new Error('indirizzo pubblico sconosciuto: usa --host <IP pubblico>')
    log(`ATTENZIONE: --host non indicato, uso ${host}. Se la macchina è dietro NAT indica l'IP pubblico.`)
  }
  const port = Number(values.port ?? env.MICELIO_SERVER_PORT ?? DEFAULT_PORT)
  const extraNodes = Number(values['extra-nodes'] ?? env.MICELIO_SERVER_EXTRA_NODES ?? 0)
  const bindHost = values.bind ?? env.MICELIO_SERVER_BIND ?? '0.0.0.0'
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`porta non valida: ${port}`)

  const server = await startServer({ publicHost: host, port, bindHost, extraNodes, log })
  log(`pronto. Sui PC del team: micelio network set ${server.bootstrap}`)

  // Battito periodico: conferma che il processo è vivo e dice cosa è successo nell'intervallo.
  // Con 0 PC il problema è prima del server (indirizzo o porta UDP non raggiungibili, PC su
  // un'altra rete); con PC ma senza presentazioni, i PC non si cercano (team o rete diversi);
  // con presentazioni ma nessun peer sui PC, l'hole punching fallisce e serve il relay.
  // EN: Periodic heartbeat: confirms the process is alive and says what happened in the interval. With 0 PCs
  //     the problem is before the server (address or UDP port not reachable, PCs on another network); with PCs
  //     but no handshakes, the PCs are not looking for each other (different team or network); with handshakes
  //     but no peers on the PCs, hole punching fails and the relay is needed.
  const timer = setInterval(() => {
    const a = server.activity()
    log(`attivo; ultimi 15 min: ${a.clients} PC, ${a.announces} annunci, ${a.lookups} ricerche, ${a.handshakes} presentazioni, ${a.holepunches} hole punching; relay: ${a.relay.active} connessioni aperte (${a.relay.sessions} dall'avvio)`)
  }, STATUS_EVERY_MS)

  // Chiusura ordinata (systemctl stop invia SIGTERM; Ctrl+C invia SIGINT).
  // EN: Orderly shutdown (systemctl stop sends SIGTERM; Ctrl+C sends SIGINT).
  const stop = async (signal: string) => {
    log(`${signal} ricevuto: chiusura`)
    clearInterval(timer)
    await server.close().catch(() => {})
    process.exit(0)
  }
  process.once('SIGINT', () => void stop('SIGINT'))
  process.once('SIGTERM', () => void stop('SIGTERM'))
}

main().catch((err) => {
  console.error(`micelio-server: ${(err as Error).message}`)
  process.exit(1)
})
