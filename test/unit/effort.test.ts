// B12: fatica di un capitolo e vantaggio nell'attivazione.
// EN: B12: a chapter's effort and the head start in activation.
import { describe, expect, it } from 'vitest'
import { HARD_EFFORT, sessionEffort } from '../../src/ingest/effort'
import { activation, EFFORT_BONUS } from '../../src/rank/activation'

const MIN = 60_000
const DAY = 24 * 3600 * 1000
const NOW = 1_800_000_000_000

describe('fatica', () => {
  it('metà errori, un quarto durata, un quarto messaggi; ogni parte satura', () => {
    expect(sessionEffort({ errors: 0, userTurns: 0, firstAt: null, lastAt: null })).toEqual({ score: 0, errors: 0, minutes: 0 })
    expect(sessionEffort({ errors: 15, userTurns: 25, firstAt: 0, lastAt: 120 * MIN }).score).toBe(1)
    expect(sessionEffort({ errors: 100, userTurns: 0, firstAt: 0, lastAt: 0 }).score).toBe(0.5)
    expect(sessionEffort({ errors: 0, userTurns: 0, firstAt: 0, lastAt: 600 * MIN })).toEqual({ score: 0.25, errors: 0, minutes: 600 })
    // Capitolo medio reale (1 errore, 46 minuti, 5 messaggi): lontano dalla soglia "difficile"
    // EN: Real median chapter (1 error, 46 minutes, 5 messages): far from the "hard" threshold
    expect(sessionEffort({ errors: 1, userTurns: 5, firstAt: 0, lastAt: 46 * MIN }).score).toBeLessThan(HARD_EFFORT / 2)
  })

  it('vantaggio nell\'attivazione: fino a +0.15, decade con la recency', () => {
    const base = { kind: 'gotcha', createdAt: NOW, uses: 0, votes: 0, degree: 0, pinned: false }
    expect(activation({ ...base, effort: 1 }, NOW) - activation(base, NOW)).toBeCloseTo(EFFORT_BONUS)
    const old = { ...base, createdAt: NOW - 360 * DAY }
    // Dopo tre emivite (gotcha: 120 giorni) resta un ottavo del vantaggio
    // EN: After three half-lives (gotcha: 120 days) an eighth of the head start remains
    expect(activation({ ...old, effort: 1 }, NOW) - activation(old, NOW)).toBeCloseTo(EFFORT_BONUS / 8)
    expect(activation({ ...base, effort: 5 }, NOW)).toBeLessThanOrEqual(1)
  })
})
