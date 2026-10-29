import { beforeAll, describe, expect, it } from 'vitest'
import loadHighs, { type Highs } from 'highs'
import { solveAccountPlan, buildPlannerModel, validatePlannerInput } from './solver'
import type { PlannerInput, PlannerAccount } from './types'
let highs: Highs
beforeAll(async () => { highs = await loadHighs() })
const now = Date.parse('2026-10-30T00:00:00Z')
const hour = 3600_000
function account(id: string, overrides: Partial<PlannerAccount> = {}): PlannerAccount {
  return { id, name: id, plan: 'pro-5x', weight: 1, priority: 0, remainingPercent: 100, resetAt: now + 7 * 24 * hour, observedAt: now, disabled: false, issues: [], cards: [], stopAt: null, minimumPercent: 0, shortRemainingPercent: null, shortResetAt: null, shortWindowSeconds: null, ...overrides }
}
function input(accounts: PlannerAccount[], overrides: Partial<PlannerInput> = {}): PlannerInput {
  return { accounts, now, end: now + 24 * hour, monthEnd: now + 12 * hour, dailyDemand: 1000, uncertaintyPercent: 10, slotHours: 6, model: 'same-model', effort: 'high', shortCapacity: {}, allowCards: false, resumeDelayMinutes: 10, ...overrides }
}

describe('finite horizon optimization with actual HiGHS', () => {
  it('uses a single demand pool, not demand once per account', async () => {
    const result = await solveAccountPlan(input([account('a'), account('b')], { dailyDemand: 50 }), highs)
    expect(result.status).toBe('optimal')
    expect(result.ranking[0].score).toBeCloseTo(50, 5)
    expect(result.tied).toBe(true)
  })
  it('5x 100% equals 20x 50%; capacity names are not multipliers', async () => {
    const result = await solveAccountPlan(input([account('a'), account('b', { weight: 2, remainingPercent: 50 })]), highs)
    expect(result.status).toBe('optimal')
    expect(result.ranking[0].score).toBeCloseTo(200)
    expect(result.ranking[1].score).toBeCloseTo(200)
  })
  it('beats remaining-capacity greedy when a small account resets imminently', async () => {
    const result = await solveAccountPlan(input([account('small', { remainingPercent: 5, resetAt: now + 5 * 60_000 }), account('large', { weight: 2 })], { dailyDemand: 2880 }), highs)
    expect(result.status).toBe('optimal')
    expect(result.ranking[0].accountId).toBe('small')
    expect(result.ranking[0].score).toBeCloseTo(305)
    expect(result.ranking[1].score).toBeCloseTo(300)
  })
  it('natural reset occurs once at its boundary, not every later slot', async () => {
    const result = await solveAccountPlan(input([account('a', { remainingPercent: 10, resetAt: now + hour })]), highs)
    expect(result.status).toBe('optimal')
    expect(result.ranking[0].score).toBeCloseTo(110)
  })
  it('enforces minimum floor, short window capacity, and manual stop', async () => {
    const a = account('a', { minimumPercent: 10, shortRemainingPercent: 50, shortResetAt: now + 10 * hour, shortWindowSeconds: 36000, stopAt: now + 2 * hour })
    const result = await solveAccountPlan(input([a], { shortCapacity: { a: 20 } }), highs)
    expect(result.status).toBe('optimal')
    expect(result.ranking[0].score).toBeCloseTo(8)
    expect(result.ranking[0].actions.every(a => a.end <= now + 2 * hour)).toBe(true)
  })
  it('card is used at most once, before deadline and with drain/resume blackout', async () => {
    const a = account('a', { remainingPercent: 20, cards: [{ id: 'one', expiresAt: now + 8 * hour }] })
    const result = await solveAccountPlan(input([a], { allowCards: true, uncertaintyPercent: 0 }), highs)
    expect(result.status).toBe('optimal')
    const winner = result.ranking[0]
    expect(winner.score).toBeCloseTo(120)
    const cards = winner.actions.filter(x => x.cardId)
    expect(cards).toHaveLength(1)
    expect(cards[0].at).toBeLessThanOrEqual(a.cards[0].expiresAt - 600_000)
    expect(winner.actions.filter(x => !x.cardId).every(x => x.end <= cards[0].at - 180_000 || x.at >= cards[0].end)).toBe(true)
  })
  it('does not recommend a card without strictly positive marginal benefit', async () => {
    const result = await solveAccountPlan(input([account('a', { cards: [{ id: 'one', expiresAt: now + 8 * hour }] })], { allowCards: true, dailyDemand: 10 }), highs)
    expect(result.status).toBe('optimal')
    expect(result.ranking[0].actions.some(x => x.cardId)).toBe(false)
    expect(result.ranking[0].score).toBeCloseTo(10)
  })
  it('existing reset stop remains binding even when hypothetical card resumption enabled', async () => {
    const result = await solveAccountPlan(input([account('a', { stopAt: now + hour, cards: [{ id: 'one', expiresAt: now + 4 * hour }] })], { allowCards: true }), highs)
    expect(result.status).toBe('optimal')
    expect(result.ranking[0].actions.every(x => x.end <= now + hour)).toBe(true)
  })
  it('separately accounts for month boundary consumption', async () => {
    const result = await solveAccountPlan(input([account('a')], { dailyDemand: 80 }), highs)
    expect(result.status).toBe('optimal')
    expect(result.ranking[0].score).toBeCloseTo(80)
    expect(result.ranking[0].monthScore).toBeCloseTo(40)
  })
  it('does not fabricate data or label an interrupted solver optimal', async () => {
    expect(validatePlannerInput(input([account('a', { weight: null })]))).toMatch('权重')
    expect(validatePlannerInput(input([account('a', { observedAt: now - 16 * 60_000 })]))).toMatch('过期')
    const fake = { solve: () => ({ Status: 'Time limit reached' }) } as unknown as Highs
    const result = await solveAccountPlan(input([account('a')]), fake)
    expect(result.status).toBe('incomplete')
    expect(result.ranking).toEqual([])
  })
  it('does not insert expired cards or expose account identifiers in solver symbols', () => {
    const model = buildPlannerModel(input([account('private@example.com', { cards: [{ id: 'secret', expiresAt: now }] })], { allowCards: true }), 0)
    expect(model.choices).toEqual([])
    expect(model.lp).not.toContain('private@example.com')
    expect(model.lp).not.toContain('secret')
  })
})
