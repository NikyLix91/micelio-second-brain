/**
 * Pannello del ricordo: i riferimenti al codice (source.code) si vedono e i commit diventano link
 * alla pagina del commit quando il repository è su un server web.
 * fetch è finto: restituisce il ricordo completo che il pannello carica all'apertura.
 *
 * EN: Memory panel: code references (source.code) are shown and commits become links
 * to the commit page when the repository is on a web server.
 * fetch is fake: it returns the full memory the panel loads when it opens.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTokenForTests } from '../api/auth'
import type { GraphNode, RecallHit } from '../api/client'
import { MemoryPanel } from '../components/MemoryPanel'

const HASH = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b'

const node = { id: 'm1', title: 'OrderService centralizza la conferma', kind: 'decision', tags: ['ordini'], author: 'aa'.repeat(32), authorName: 'alice', ts: 0 } as unknown as GraphNode

const hit = {
  ...node,
  body: 'La conferma degli ordini passa da OrderService.',
  source: {
    type: 'claude-code',
    code: {
      project: 'ordini',
      branch: 'feature/conferma',
      repo: 'https://dev.azure.com/org/prj/_git/ordini',
      files: ['src/orders/order.service.ts'],
      symbols: ['class OrderService'],
      commits: [HASH]
    }
  },
  activation: 0.5, votes: 0, uses: 0, pinned: false
} as unknown as RecallHit

describe('MemoryPanel: riferimenti al codice', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('mostra progetto, branch, file, simboli e link al commit', async () => {
    setTokenForTests('tok')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(hit)))
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><MemoryPanel node={node} onClose={() => {}} /></MemoryRouter>
      </QueryClientProvider>
    )
    expect(await screen.findByText('ordini')).toBeTruthy()
    expect(screen.getByText('feature/conferma')).toBeTruthy()
    expect(screen.getByText('src/orders/order.service.ts')).toBeTruthy()
    expect(screen.getByText('class OrderService')).toBeTruthy()
    const link = screen.getByText(HASH.slice(0, 8)).closest('a')!
    expect(link.getAttribute('href')).toBe(`https://dev.azure.com/org/prj/_git/ordini/commit/${HASH}`)
  })
})
