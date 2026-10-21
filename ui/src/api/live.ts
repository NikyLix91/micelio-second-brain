/**
 * @file Aggiornamenti in tempo reale: legge lo stream SSE del daemon (GET /api/events) e
 * invalida le query di TanStack Query interessate, che quindi si ricaricano da sole.
 *
 * Perché `fetch` e non `EventSource`: EventSource non permette di impostare l'header
 * Authorization, e non vogliamo mettere il token nell'URL. Con fetch leggiamo lo stream a mano
 * (formato SSE: blocchi separati da una riga vuota, righe "event:" e "data:").
 *
 * Se la connessione cade (daemon riavviato, PC in sospensione) si riconnette con un'attesa
 * crescente, fino a 10 secondi tra un tentativo e l'altro.
 *
 * EN: Live updates: reads the daemon's SSE stream (GET /api/events) and invalidates the affected
 * TanStack Query queries, which then reload on their own.
 *
 * EN: Why `fetch` and not `EventSource`: EventSource doesn't allow setting the Authorization
 * header, and we don't want to put the token in the URL. With fetch we read the stream by hand
 * (SSE format: blocks separated by an empty line, "event:" and "data:" lines).
 *
 * EN: If the connection drops (daemon restarted, PC asleep) it reconnects with an increasing
 * delay, up to 10 seconds between attempts.
 */
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { getToken } from './auth'
import { teamHeaders, useCurrentTeam } from './team'

/**
 * Quali query ricaricare per ogni argomento (ChangeTopic del daemon).
 * Le chiavi sono quelle usate nelle schermate con useQuery.
 *
 * EN: Which queries to reload for each topic (the daemon's ChangeTopic).
 * The keys are the ones used in the screens with useQuery.
 */
export const TOPIC_QUERIES: Record<string, string[][]> = {
  status: [['status'], ['teamConfig'], ['distillQuality']],
  memories: [['memories'], ['graph'], ['dreams'], ['archive'], ['storage'], ['roots'], ['distillQuality'], ['personal'], ['stale'], ['digest'], ['gaps']],
  members: [['members'], ['invites'], ['graph'], ['storage']],
  inbox: [['inbox'], ['ingest']],
  jobs: [['ingest'], ['documents']],
  decisions: [['decisions']],
  settings: [['settings'], ['ingest'], ['documents'], ['network'], ['backupSettings']],
  // Elenco dei team del PC (B3): nome, ruolo, team aggiunti o tolti
  // EN: List of the PC's teams (B3): name, role, teams added or removed
  teams: [['teams']],
  // Lacune di conoscenza (B4)
  // EN: Knowledge gaps (B4)
  gaps: [['gaps'], ['digest']],
  roots: [['roots'], ['rootSuggestions']],
  security: [['security']],
  // B11: consultazioni degli agenti ed esiti
  // EN: B11: agent queries and outcomes
  efficacy: [['efficacy']]
}

/** Un evento SSE già interpretato. / EN: An already parsed SSE event. */
export interface SseEvent { event: string, data: string }

/**
 * Estrae gli eventi completi da un buffer di testo SSE.
 *
 * EN: Extracts the complete events from an SSE text buffer.
 * @returns gli eventi trovati e il resto del buffer (un evento non ancora completo)
 *          EN: the events found and the rest of the buffer (an event not yet complete)
 */
export function parseSse (buffer: string): { events: SseEvent[], rest: string } {
  const events: SseEvent[] = []
  const blocks = buffer.split(/\r?\n\r?\n/)
  const rest = blocks.pop() ?? '' // l'ultimo pezzo potrebbe essere incompleto / EN: the last piece may be incomplete
  for (const block of blocks) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue // commento (i "ping" di keep-alive) / EN: comment (the keep-alive "pings")
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trim())
    }
    if (data.length || event !== 'message') events.push({ event, data: data.join('\n') })
  }
  return { events, rest }
}

/** Applica un evento "change" alla cache delle query. / EN: Applies a "change" event to the query cache. */
export function applyChange (client: QueryClient, data: string): void {
  try {
    const { topic } = JSON.parse(data) as { topic: string }
    for (const key of TOPIC_QUERIES[topic] ?? []) void client.invalidateQueries({ queryKey: key })
  } catch {
    // evento malformato: ignorato
    // EN: malformed event: ignored
  }
}

/**
 * Hook React: mantiene aperto lo stream finché il componente è montato.
 *
 * EN: React hook: keeps the stream open while the component is mounted.
 * @returns true quando lo stream è connesso (mostrato nella barra laterale)
 *          EN: true when the stream is connected (shown in the sidebar)
 */
export function useLiveEvents (): boolean {
  const client = useQueryClient()
  const [connected, setConnected] = useState(false)
  // Lo stream riguarda il team scelto: cambiando team si chiude e si riapre (vedi le dipendenze)
  // EN: The stream is about the selected team: switching team closes and reopens it (see the dependencies)
  const team = useCurrentTeam()

  useEffect(() => {
    let stopped = false
    let controller: AbortController | null = null

    async function loop (): Promise<void> {
      let delay = 1000
      while (!stopped) {
        controller = new AbortController()
        try {
          const res = await fetch('/api/events', { headers: { authorization: `Bearer ${getToken() ?? ''}`, ...teamHeaders() }, signal: controller.signal })
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
          setConnected(true)
          delay = 1000
          // Alla (ri)connessione potremmo aver perso eventi: ricarichiamo tutto una volta.
          // EN: On (re)connection we may have missed events: reload everything once.
          void client.invalidateQueries()
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          while (!stopped) {
            const { value, done } = await reader.read()
            if (done) break
            const parsed = parseSse(buffer + decoder.decode(value, { stream: true }))
            buffer = parsed.rest
            for (const e of parsed.events) if (e.event === 'change') applyChange(client, e.data)
          }
        } catch {
          // connessione fallita o interrotta: si riprova
          // EN: connection failed or interrupted: retry
        }
        setConnected(false)
        if (stopped) break
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, 10_000)
      }
    }
    void loop()
    return () => {
      stopped = true
      controller?.abort()
    }
  }, [client, team])

  return connected
}
