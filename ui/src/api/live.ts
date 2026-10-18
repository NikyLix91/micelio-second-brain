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
 */
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { getToken } from './auth'

/**
 * Quali query ricaricare per ogni argomento (ChangeTopic del daemon).
 * Le chiavi sono quelle usate nelle schermate con useQuery.
 */
export const TOPIC_QUERIES: Record<string, string[][]> = {
  status: [['status'], ['teamConfig']],
  memories: [['memories'], ['graph'], ['dreams'], ['archive'], ['storage'], ['roots']],
  members: [['members'], ['invites'], ['graph'], ['storage']],
  inbox: [['inbox'], ['ingest']],
  jobs: [['ingest'], ['documents']],
  decisions: [['decisions']],
  settings: [['settings'], ['ingest'], ['documents'], ['network']],
  roots: [['roots'], ['rootSuggestions']]
}

/** Un evento SSE già interpretato. */
export interface SseEvent { event: string, data: string }

/**
 * Estrae gli eventi completi da un buffer di testo SSE.
 * @returns gli eventi trovati e il resto del buffer (un evento non ancora completo)
 */
export function parseSse (buffer: string): { events: SseEvent[], rest: string } {
  const events: SseEvent[] = []
  const blocks = buffer.split(/\r?\n\r?\n/)
  const rest = blocks.pop() ?? '' // l'ultimo pezzo potrebbe essere incompleto
  for (const block of blocks) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue // commento (i "ping" di keep-alive)
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trim())
    }
    if (data.length || event !== 'message') events.push({ event, data: data.join('\n') })
  }
  return { events, rest }
}

/** Applica un evento "change" alla cache delle query. */
export function applyChange (client: QueryClient, data: string): void {
  try {
    const { topic } = JSON.parse(data) as { topic: string }
    for (const key of TOPIC_QUERIES[topic] ?? []) void client.invalidateQueries({ queryKey: key })
  } catch {
    // evento malformato: ignorato
  }
}

/**
 * Hook React: mantiene aperto lo stream finché il componente è montato.
 * @returns true quando lo stream è connesso (mostrato nella barra laterale)
 */
export function useLiveEvents (): boolean {
  const client = useQueryClient()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let stopped = false
    let controller: AbortController | null = null

    async function loop (): Promise<void> {
      let delay = 1000
      while (!stopped) {
        controller = new AbortController()
        try {
          const res = await fetch('/api/events', { headers: { authorization: `Bearer ${getToken() ?? ''}` }, signal: controller.signal })
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
          setConnected(true)
          delay = 1000
          // Alla (ri)connessione potremmo aver perso eventi: ricarichiamo tutto una volta.
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
  }, [client])

  return connected
}
