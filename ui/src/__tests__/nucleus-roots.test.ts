/**
 * Nucleo 3D con molte Radici: il nucleo si allarga con il loro numero (sempre dentro il guscio dei
 * ricordi, che parte dal 45% del raggio) e ogni Radice si attenua, così un vault importato non
 * diventa una palla bianca.
 *
 * EN: 3D Nucleus with many Roots: the nucleus grows with their number (always inside the memory shell, which
 * starts at 45% of the radius) and each Root gets dimmer, so an imported vault does not turn into a
 * white ball.
 */
import { describe, expect, it } from 'vitest'
import { rootCore, rootCrowding } from '../pages/nucleus/hologram'

describe('nucleo delle Radici', () => {
  it('poche Radici: come prima; di più: nucleo più largo; decine: nel guscio', () => {
    expect(rootCore(3)).toEqual({ inner: 0.08, outer: 0.28 })
    const mid = rootCore(20)
    expect(mid.outer).toBeGreaterThan(0.38)
    expect(mid.outer).toBeLessThan(0.45)
    expect(mid.inner).toBeLessThan(mid.outer)
    // decine di Radici (un vault): niente nucleo, si distribuiscono nel guscio dei ricordi
    // EN: dozens of Roots (a vault): no nucleus, they spread over the memory shell
    expect(rootCore(63)).toEqual({ inner: 0.45, outer: 1 })
  })

  it('oltre 4 Radici accese ognuna si attenua, fino a un minimo', () => {
    expect(rootCrowding(3)).toBe(1)
    expect(rootCrowding(9)).toBeCloseTo(Math.sqrt(4 / 9)) // una tappa del tour / EN: a tour stop
    expect(rootCrowding(1000)).toBe(0.3)
  })
})
