// B12: abituazione, funzioni pure (serie di esiti senza uso e fattore di peso).
// EN: B12: habituation, pure functions (runs of outcomes with no use and weight factor).
import { describe, expect, it } from 'vitest'
import { HABITUATION_MIN, habituationFactor, habituationStreaks, softHabituation } from '../../src/rank/habituation'

describe('abituazione', () => {
  it('conta gli esiti senza uso di fila dall\'ultimo utile', () => {
    const s = habituationStreaks([
      { memory: 'a', verdict: 'none' },
      { memory: 'a', verdict: 'ignored' },
      { memory: 'b', verdict: 'none' },
      { memory: 'a', verdict: 'wrong' }, // "sbagliato" non è servito / EN: "wrong" didn't help
      { memory: 'b', verdict: 'likely' }, // utile: azzera / EN: useful: resets
      { memory: 'c', verdict: 'none' },
      { memory: 'c', verdict: 'used' },
      { memory: 'c', verdict: 'none' }
    ])
    expect(Object.fromEntries(s)).toEqual({ a: 3, c: 1 }) // b azzerato: non serve tenerlo / EN: b reset: no need to keep it
  })

  it('fattore: tolleranza, poi scende fino al minimo', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map(habituationFactor)).toEqual([1, 1, 1, 0.85, 0.7, 0.55, expect.closeTo(0.4, 10), HABITUATION_MIN, HABITUATION_MIN])
  })

  it('nelle ricerche esplicite pesa la metà', () => {
    expect(softHabituation(1)).toBe(1)
    expect(softHabituation(HABITUATION_MIN)).toBeCloseTo(0.65)
  })

  it('a scala: 100 000 esiti su 5 000 ricordi in pochi millisecondi', () => {
    const verdicts = ['none', 'ignored', 'likely', 'used', 'wrong']
    const rows = Array.from({ length: 100_000 }, (_, i) => ({ memory: `m${i % 5000}`, verdict: verdicts[(i * 7) % 5] }))
    const t0 = performance.now()
    const s = habituationStreaks(rows)
    const ms = performance.now() - t0
    expect(s.size).toBeGreaterThan(0)
    expect(ms).toBeLessThan(200)
  })
})
