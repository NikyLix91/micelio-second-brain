/**
 * Nucleo 3D con molte Radici: il nucleo si allarga con il loro numero (sempre dentro il guscio dei
 * ricordi, che parte dal 45% del raggio) e ogni Radice si attenua, così un vault importato non
 * diventa una palla bianca.
 */
import { describe, expect, it } from 'vitest'
import { rootCore, rootCrowding } from '../pages/nucleus/hologram'

describe('nucleo delle Radici', () => {
  it('poche Radici: come prima; molte: nucleo più largo ma dentro il guscio', () => {
    expect(rootCore(3)).toEqual({ inner: 0.08, outer: 0.28 })
    const big = rootCore(63)
    expect(big.outer).toBeGreaterThan(0.4)
    expect(big.outer).toBeLessThan(0.45)
    expect(big.inner).toBeLessThan(big.outer)
  })

  it('oltre la decina ogni Radice si attenua, fino a un minimo', () => {
    expect(rootCrowding(5)).toBe(1)
    expect(rootCrowding(63)).toBeCloseTo(Math.sqrt(10 / 63))
    expect(rootCrowding(1000)).toBe(0.35)
  })
})
