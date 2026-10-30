import type { Highs } from 'highs'
import type { PlannerInput, PlannerResult, PlannerAction, PlannerRank } from './types'

const MINUTE = 60_000
const DAY = 86400_000
const WEEK = 7 * DAY
const EPS = 1e-5
const MAX_SLOTS = 1800
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
type ResetChoice = { name: string; account: number; time: number; cardId: string }
type Model = { lp: string; times: number[]; choices: ResetChoice[] }
type Solution = { score: number; monthScore: number; actions: PlannerAction[]; cards: string[] }

export function validatePlannerInput(input: PlannerInput): string | null {
  if (!input.model.trim() || !input.effort.trim()) return '请指定同一模型和 effort。'
  if (!finite(input.now) || !finite(input.end) || input.end <= input.now || input.end - input.now > 62 * DAY) return '规划期必须在未来 62 天内。'
  if (!finite(input.monthEnd) || input.monthEnd < input.now || input.monthEnd > input.end) return '规划期必须覆盖本月末。'
  if (!finite(input.dailyDemand) || input.dailyDemand <= 0 || input.dailyDemand > 10_000) return '请提供有效的每日加权周额度需求（0–10000）。'
  if (!finite(input.uncertaintyPercent) || input.uncertaintyPercent < 0 || input.uncertaintyPercent >= 100) return '需求波动必须在 0–99% 内。'
  if (!finite(input.slotHours) || input.slotHours < 1 || input.slotHours > 24) return '时间网格必须为 1–24 小时。'
  if (!finite(input.resumeDelayMinutes) || input.resumeDelayMinutes < 1 || input.resumeDelayMinutes > 1440) return '人工恢复延时必须为 1–1440 分钟。'
  if (!input.accounts.length || input.accounts.length > 12 || new Set(input.accounts.map(a => a.id)).size !== input.accounts.length) return '请选择 1–12 个不同账号。'
  for (const a of input.accounts) {
    if (a.issues.length || a.disabled) return `${a.name}：${a.disabled ? '账号已停用' : a.issues.join('；')}`
    if (a.weight !== 1 && a.weight !== 2) return `${a.name}：账号权重未知。`
    if (!finite(a.remainingPercent) || a.remainingPercent < 0 || a.remainingPercent > 100 || !finite(a.resetAt) || a.resetAt <= input.now) return `${a.name}：周额度或下次重置时间缺失/过期。`
    if (!finite(a.observedAt) || input.now - a.observedAt > 15 * MINUTE || a.observedAt > input.now + MINUTE) return `${a.name}：额度快照已过期，请刷新额度后重读。`
    if (!finite(a.minimumPercent) || a.minimumPercent < 0 || a.minimumPercent >= 100) return `${a.name}：额度下限无效。`
    if (a.accountExpiresAt != null && a.accountExpiresAt <= input.now) return `${a.name}：账号已到期。`
    if (a.stopAt !== null && (!finite(a.stopAt) || a.stopAt <= input.now)) return `${a.name}：已到停派时间。`
    if (a.shortWindowSeconds !== null) {
      if (!finite(a.shortWindowSeconds) || a.shortWindowSeconds <= 0 || a.shortWindowSeconds >= 604800 || !finite(a.shortRemainingPercent) || a.shortRemainingPercent < 0 || a.shortRemainingPercent > 100 || !finite(a.shortResetAt) || a.shortResetAt <= input.now) return `${a.name}：短时额度数据缺失/过期。`
      if (!finite(input.shortCapacity[a.id]) || input.shortCapacity[a.id] <= 0 || input.shortCapacity[a.id] > 10000) return `${a.name}：请填写短窗满额对应的加权周百分点。`
    }
    if (a.cards.length > 4 || new Set(a.cards.map(c => c.id)).size !== a.cards.length || a.cards.some(c => !finite(c.expiresAt))) return `${a.name}：卡数据无效或超过 4 张的求解上限。`
  }
  return null
}

// The finite model allows continuous consumption inside event intervals, but card
// decisions only on the published grid or at expiry-10min. These are scenario
// assumptions, not a claim about continuous-time global optimality.
export function buildPlannerModel(input: PlannerInput, first: number | null, multiplier = 1, forbidden = new Set<string>()): Model {
  const boundaries = new Set<number>([input.now, input.end, input.monthEnd, Math.min(input.end, input.now + 5 * MINUTE)])
  const grid: number[] = []
  for (let t = input.now + input.slotHours * 3600_000; t < input.end; t += input.slotHours * 3600_000) { grid.push(t); boundaries.add(t) }
  const choices: ResetChoice[] = []
  const natural: Set<number>[] = []
  const shortNatural: Set<number>[] = []
  const add = (t: number) => { if (t > input.now && t < input.end) boundaries.add(t) }
  input.accounts.forEach((a, i) => {
    const weeklyTimes = new Set<number>()
    for (let t = a.resetAt!; t < input.end; t += WEEK) { weeklyTimes.add(t); add(t) }
    natural.push(weeklyTimes)
    const shortTimes = new Set<number>()
    if (a.shortWindowSeconds !== null) for (let t = a.shortResetAt!; t < input.end; t += a.shortWindowSeconds * 1000) { shortTimes.add(t); add(t) }
    shortNatural.push(shortTimes)
    if (a.stopAt !== null) add(a.stopAt)
    if (!input.allowCards) return
    for (const card of a.cards) {
      if (forbidden.has(`${a.id}/${card.id}`)) continue
      const deadline = card.expiresAt - 10 * MINUTE
      const candidates = new Set(input.cardTiming === 'expiry' ? [deadline] : [...grid.filter(t => t <= deadline), deadline])
      for (const t of candidates) {
        if (t < input.now + 3 * MINUTE || t >= input.end || (a.stopAt !== null && t >= a.stopAt) || weeklyTimes.has(t)) continue
        const name = `y${choices.length}`
        choices.push({ name, account: i, time: t, cardId: card.id })
        add(t); add(t - 3 * MINUTE); add(t + input.resumeDelayMinutes * MINUTE)
      }
    }
  })
  const times = [...boundaries].filter(t => t >= input.now && t <= input.end).sort((a, b) => a - b)
  if (times.length > MAX_SLOTS) throw new Error(`事件网格超过 ${MAX_SLOTS} 个时间点，请缩短规划期或增大时间网格。`)
  const constraints: string[] = []
  const bounds: string[] = []
  const terms: string[] = []
  let seq = 0
  const row = (s: string) => constraints.push(`r${seq++}: ${s}`)
  const numeric = (v: number) => Number(v.toFixed(9))
  const yExpr = (i: number, t: number, factor = 1) => choices.filter(c => c.account === i && c.time === t).map(c => `${numeric(factor)} ${c.name}`)
  for (let k = 0; k < times.length - 1; k++) {
    const t = times[k], next = times[k + 1]
    const demand = numeric(input.dailyDemand * multiplier * (next - t) / DAY)
    const allX: string[] = []
    input.accounts.forEach((a, i) => {
      const x = `x${i}_${k}`
      allX.push(x); terms.push(x)
      const prohibited = (a.stopAt !== null && t >= a.stopAt) || (first !== null && k === 0 && first !== i)
      bounds.push(`0 <= ${x} <= ${prohibited ? 0 : demand}`)
      const stock = (prefix: string, cap: number, initial: number, resets: Set<number>) => {
        const end = `${prefix}${i}_${k}`, prev = `${prefix}${i}_${k - 1}`
        cap = numeric(cap); initial = numeric(initial)
        bounds.push(`0 <= ${end} <= ${cap}`)
        if (k === 0) { row(`${end} + ${x} = ${initial}`); return }
        if (resets.has(t)) { row(`${end} + ${x} = ${cap}`); return }
        const ys = yExpr(i, t, cap)
        if (!ys.length) { row(`${end} + ${x} - ${prev} = 0`); return }
        const waste = `d${prefix}${i}_${k}`
        bounds.push(`0 <= ${waste} <= ${cap}`)
        row(`${end} + ${x} - ${prev} + ${waste} - ${ys.join(' - ')} = 0`)
        row(`${waste} - ${ys.join(' - ')} <= 0`)
        row(`${waste} - ${prev} <= 0`)
        row(`${waste} - ${prev} - ${ys.join(' - ')} >= ${-cap}`)
      }
      stock('q', (100 - a.minimumPercent) * a.weight!, Math.max(0, a.remainingPercent! - a.minimumPercent) * a.weight!, natural[i])
      if (a.shortWindowSeconds !== null) {
        const shortCap = input.shortCapacity[a.id]
        stock('h', shortCap * (1 - a.minimumPercent / 100), shortCap * Math.max(0, a.shortRemainingPercent! - a.minimumPercent) / 100, shortNatural[i])
      }
      for (const c of choices) if (c.account === i && t < c.time + input.resumeDelayMinutes * MINUTE && next > c.time - 3 * MINUTE) {
        row(`${x} + ${demand} ${c.name} <= ${demand}`)
      }
    })
    row(`${allX.join(' + ')} <= ${demand}`)
  }
  input.accounts.forEach((a, i) => {
    for (const card of a.cards) {
      const vars = choices.filter(c => c.account === i && c.cardId === card.id).map(c => c.name)
      if (vars.length) row(`${vars.join(' + ')} <= 1`)
    }
  })
  for (let i = 0; i < input.accounts.length; i++) for (const t of times) {
    const vars = yExpr(i, t)
    if (vars.length > 1) row(`${vars.join(' + ')} <= 1`)
  }
  return { times, choices, lp: `Maximize\n obj: ${terms.join(' + ')}\nSubject To\n ${constraints.join('\n ')}\nBounds\n ${bounds.join('\n ')}\n${choices.length ? `Binary\n ${choices.map(c => c.name).join(' ')}\n` : ''}End` }
}

function solveOne(highs: Highs, input: PlannerInput, first: number | null, multiplier: number, forbidden: Set<string>, budgetSeconds: number): Solution {
  const model = buildPlannerModel(input, first, multiplier, forbidden)
  const result = highs.solve(model.lp, { output_flag: false, time_limit: budgetSeconds, mip_rel_gap: 0, mip_abs_gap: 1e-6, threads: 1 })
  if (result.Status !== 'Optimal') throw new Error(`求解器状态：${result.Status}。未证明最优，请缩小范围后重算。`)
  const value = (name: string) => {
    const column = result.Columns[name]
    return column && 'Primal' in column ? column.Primal : 0
  }
  const actions: PlannerAction[] = []
  let score = 0, monthScore = 0
  for (let k = 0; k < model.times.length - 1; k++) input.accounts.forEach((a, i) => {
    const consumed = value(`x${i}_${k}`)
    if (consumed <= EPS) return
    score += consumed
    if (model.times[k] < input.monthEnd) monthScore += consumed
    actions.push({ at: model.times[k], end: model.times[k + 1], accountId: a.id, consumed })
  })
  const cards: string[] = []
  for (const c of model.choices) if (value(c.name) > .5) {
    const accountId = input.accounts[c.account].id
    cards.push(`${accountId}/${c.cardId}`)
    actions.push({ at: c.time, end: c.time + input.resumeDelayMinutes * MINUTE, accountId, consumed: 0, cardId: c.cardId })
  }
  actions.sort((a, b) => a.at - b.at || a.accountId.localeCompare(b.accountId))
  return { score, monthScore, actions, cards }
}

export async function solveAccountPlan(input: PlannerInput, highs: Highs): Promise<PlannerResult> {
  const started = Date.now()
  const base = { ranking: [] as PlannerRank[], stable: false, tied: false, computedAt: input.now, slots: 0, assumptions: [
    '单位：5x 满周=100 个加权周百分点；20x 满周=200。成功率100%，固定模型与 effort。',
    '先用某账号定义为第一个事件时间段（最多5分钟）只由该账号处理需求；后续可顺序切换，不采用 RR。',
    '自然重置按已知下次重置时刻及原窗口长度重复预测；短窗换算为显式场景参数。',
    '需求按每日加权百分点均匀到达，不积压、不制造请求；低/中/高需求为三个独立场景。',
    '只在时间网格和到期前10分钟候选时刻推演用卡，停派3分钟；仅在明确允许时假设恢复100%并由用户人工启用。',
    '结果是此有限事件模型内的最优值；三点敏感性检查不等于连续预测区间上的稳健证明。',
  ], elapsedMs: 0 }
  const invalid = validatePlannerInput(input)
  if (invalid) return { ...base, status: 'invalid', message: invalid }
  const forbidden = new Set<string>()
  const multipliers = [1 - input.uncertaintyPercent / 100, 1, 1 + input.uncertaintyPercent / 100]
  let solves = 0
  const solve = (first: number | null, m: number, blocked = forbidden) => {
    if (Date.now() - started > 75_000 || ++solves > 160) throw new Error('达到求解预算，未证明最优；请减少账号、卡片或规划期。')
    return solveOne(highs, input, first, m, blocked, 5)
  }
  try {
    // Only admit cards with strictly positive marginal benefit in every tested
    // demand scenario. Re-optimize after each removal; no credit double counting.
    if (input.allowCards) {
      let repeat = true
      while (repeat) {
        repeat = false
        const plans = multipliers.map(m => solve(null, m))
        const used = [...new Set(plans.flatMap(p => p.cards))].sort()
        for (const card of used) {
          const without = new Set([...forbidden, card])
          if (multipliers.some((m, k) => plans[k].score - solve(null, m, without).score <= EPS)) {
            forbidden.add(card); repeat = true; break
          }
        }
      }
    }
    const ranking: PlannerRank[] = []
    input.accounts.forEach((a, i) => {
      if (a.remainingPercent! <= a.minimumPercent || (a.shortWindowSeconds !== null && a.shortRemainingPercent! <= a.minimumPercent)) return
      const [low, normal, high] = multipliers.map(m => solve(i, m))
      ranking.push({ accountId: a.id, score: normal.score, monthScore: normal.monthScore, lowScore: low.score, highScore: high.score, delta: 0, actions: normal.actions })
    })
    if (!ranking.length) return { ...base, status: 'invalid', message: '当前所有账号都已到额度下限，暂无可优先消耗的账号。', elapsedMs: Date.now() - started }
    const account = (id: string) => input.accounts.find(a => a.id === id)!
    const expiry = (id: string) => Math.min(...account(id).cards.filter(c => c.expiresAt > input.now).map(c => c.expiresAt), Infinity)
    ranking.sort((a, b) => {
      if (Math.abs(b.score - a.score) > EPS) return b.score - a.score
      return expiry(a.accountId) - expiry(b.accountId) || account(a.accountId).resetAt! - account(b.accountId).resetAt! || account(b.accountId).priority - account(a.accountId).priority || a.accountId.localeCompare(b.accountId)
    })
    const winner = ranking[0]
    ranking.forEach(r => { r.delta = Math.max(0, winner.score - r.score) })
    const tied = ranking.length > 1 && Math.abs(winner.score - ranking[1].score) <= EPS
    const stable = !tied && ranking.every(r => r === winner || (winner.lowScore > r.lowScore + EPS && winner.highScore > r.highScore + EPS))
    return { ...base, status: 'optimal', message: tied ? '模型内并列最优；按卡到期、自然重置、固定优先级选择。' : stable ? '已证明当前模型内最优，低中高需求场景的首选一致。' : '已证明基准场景最优；需求变化会影响排名，没有稳定最优账号。', ranking, stable, tied, slots: buildPlannerModel(input, null, 1, forbidden).times.length - 1, elapsedMs: Date.now() - started,
      assumptions: [...base.assumptions, `已排除 ${forbidden.size} 张在低中高场景中不能证明严格增益的卡；结果以此保守卡集合为约束。`] }
  } catch (error) {
    return { ...base, status: 'incomplete', message: error instanceof Error ? error.message : '求解失败，请重试。', elapsedMs: Date.now() - started }
  }
}
