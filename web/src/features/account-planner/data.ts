import { ApiError, fetchUsageIdentities, fetchUsageQuotaCache, fetchCodexQuotaHistory, fetchUsageEvents } from '@/lib/api'
import { quotaFloorRequest, type QuotaFloor } from '@/lib/quotaFloor'
import { resetScheduleRequest, type ResetSchedule } from '@/lib/resetSchedule'
import type { UsageQuotaCheckResponse, UsageQuotaRow, CodexQuotaHistoryResponse, UsageEvent } from '@/lib/types'
import type { PlannerAccount, PlannerCard, PlannerSnapshot } from './types'

const WEEK = 604800
const STALE_MS = 15 * 60 * 1000
const asMs = (v: unknown): number | null => { const n = typeof v === 'number' ? v : Date.parse(String(v ?? '')); return Number.isFinite(n) ? n : null }
const planWeight = (plan: string): 1 | 2 | null => { const s = plan.toLowerCase().replace(/[ _]/g, '-'); return s === 'pro-20x' ? 2 : s === 'pro-5x' ? 1 : null }
const fatal = (e: unknown) => { if ((e instanceof ApiError && e.status === 401) || (e instanceof Error && e.name === 'AbortError')) throw e }
const seconds = (r: UsageQuotaRow) => r.window?.seconds ?? (r.window?.unit === 'seconds' ? r.window.duration : undefined)
const remaining = (r: UsageQuotaRow | undefined): number | null => { const n = typeof r?.usedPercent === 'number' ? 100-r.usedPercent : typeof r?.remainingFraction === 'number' ? 100*r.remainingFraction : null; return n !== null && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null }
function weeklyRow(quota?: UsageQuotaCheckResponse): UsageQuotaRow | undefined {
  return quota?.quota?.find(r => r.key.startsWith('rate_limit.') && seconds(r) === WEEK)
}
function quotaValues(quota: UsageQuotaCheckResponse | undefined, now: number, issues: string[]) {
  const row = weeklyRow(quota); if (!row) { issues.push('weekly quota missing'); return { remaining: null, resetAt: null } }
  const value = remaining(row)
  const resetAt = asMs(row.resetAt)
  if (row.allowed === false || row.limitReached === true) issues.push('weekly quota currently limited')
  if (value === null || resetAt === null) issues.push('周额度或重置时间缺失')
  if (resetAt !== null && resetAt <= now) issues.push('周额度重置时间已过，需更新缓存')
  return { remaining: value, resetAt }
}
export async function loadPlannerSnapshot(signal?: AbortSignal): Promise<PlannerSnapshot> {
  const now = Date.now(); const identitiesResponse = await fetchUsageIdentities(signal)
  const identities = (identitiesResponse.identities ?? []).filter(i => !i.is_deleted && i.auth_type === 1 && (String(i.type).toLowerCase() === 'codex' || String(i.provider).toLowerCase() === 'codex'))
  const indexes = identities.map(i => i.identity)
  const cacheResponse = await fetchUsageQuotaCache(indexes, signal)
  const details: [PromiseSettledResult<QuotaFloor>, PromiseSettledResult<ResetSchedule>][] = []
  for (let offset = 0; offset < identities.length; offset += 8) {
    const batch = identities.slice(offset, offset + 8)
    details.push(...await Promise.all(batch.map(i => Promise.allSettled([quotaFloorRequest(i.identity), resetScheduleRequest(i.identity)]))))
  }
  signal?.throwIfAborted()
  for (const pair of details) for (const r of pair) if (r.status === 'rejected') fatal(r.reason)
  const cache = new Map((cacheResponse.items ?? []).map(x => [x.auth_index, x]))
  const accounts: PlannerAccount[] = identities.map((identity, idx) => {
    const issues: string[] = []; const item = cache.get(identity.identity); const quota = item?.quota
    const refreshedAt = asMs(item?.refreshed_at); const expiresAt = asMs(item?.expires_at)
    if (!item) issues.push('quota cache missing'); else if (item.status !== 'completed' || !quota) issues.push('额度缓存不可用')
    if (refreshedAt === null) issues.push('缓存观察时间缺失')
    if (item && ((refreshedAt !== null && now - refreshedAt > STALE_MS) || (expiresAt !== null && expiresAt <= now))) issues.push('quota cache expired')
    const q = quotaValues(quota, now, issues); const settled = details[idx]
    const floorResult = settled[0].status === 'fulfilled' ? settled[0].value : null; const schedule = settled[1].status === 'fulfilled' ? settled[1].value : null
    if (!floorResult) issues.push('quota floor unavailable'); if (!schedule) issues.push('reset schedule unavailable')
    const plan = quota?.subscription?.plan ?? identity.subscription?.plan ?? ''
    if (planWeight(plan) === null) issues.push('账号额度权重未知')
    if (schedule?.error) issues.push('重置卡状态不可确认')
    const uncertain = new Set((schedule?.tasks ?? []).filter(t => ['running','unknown'].includes(t.state) || t.result_code === 'consume_result_unknown').map(t => t.credit_id))
    if (uncertain.size) issues.push('存在执行中或结果未知的卡，未计入可用卡')
    const used = new Set((schedule?.tasks ?? []).filter(t => t.attempts > 0 || ['succeeded','completed','used'].includes(t.state)).map(t => t.credit_id))
    const cards: PlannerCard[] = (schedule?.credits ?? []).filter(c => c.status === 'available' && !uncertain.has(c.id) && !used.has(c.id) && !schedule?.error).map(c => ({ id: c.id, expiresAt: asMs(c.expiresAt) ?? 0 })).filter(c => c.expiresAt > now)
    const taskStops = (schedule?.tasks ?? []).filter(t => t.state === 'pending' || t.state === 'running').map(t => t.state === 'running' ? now : (asMs(t.scheduled_at) === null ? null : asMs(t.scheduled_at)! - 3 * 60 * 1000)) .filter((x): x is number => x !== null)
    const expiryStops = schedule?.auto_before_expiry ? cards.map(c => c.expiresAt - 13 * 60 * 1000) : []
    const rawFloor = floorResult as (QuotaFloor & { reset_dispatch_until?: string | null }) | null
    const dispatchTimes = [asMs(rawFloor?.dispatch_until), asMs(rawFloor?.reset_dispatch_until)].filter((t): t is number => t !== null)
    if (rawFloor?.paused || rawFloor?.manual_hold) issues.push('额度停派保护生效')
    const stopCandidates = [...taskStops, ...expiryStops, ...dispatchTimes]
    const short = quota?.quota.find(r => r.key.startsWith('rate_limit.') && (seconds(r) ?? 0) > 0 && seconds(r)! < WEEK)
    if (short?.allowed === false || short?.limitReached === true) issues.push('短窗当前限流')
    if (short && (remaining(short) === null || asMs(short.resetAt) === null)) issues.push('短窗额度信息缺失')
    const disabled = Boolean(identity.disabled)
    return { id: identity.identity, name: identity.displayName ?? identity.alias ?? identity.name ?? identity.identity, plan, weight: planWeight(plan), priority: identity.priority ?? 0, remainingPercent: q.remaining, resetAt: q.resetAt, observedAt: refreshedAt, disabled, issues, cards, stopAt: stopCandidates.length ? Math.min(...stopCandidates) : null, minimumPercent: floorResult?.minimum_percent ?? 0, shortRemainingPercent: remaining(short), shortResetAt: asMs(short?.resetAt), shortWindowSeconds: short ? seconds(short) ?? null : null }
  })
  return { accounts, loadedAt: now }
}

export interface DemandEstimate { dailyDemand: number | null; message: string }
/** A demand estimate never allocates mixed-model quota changes proportionally. */
export async function estimatePlannerDemand(accounts: PlannerAccount[], model: string, effort: string, signal?: AbortSignal): Promise<DemandEstimate> {
  const none = (message: string): DemandEstimate => ({ dailyDemand: null, message })
  if (!accounts.length || !model.trim() || !effort.trim()) return none('请先选择账号、模型和 effort')
  if (accounts.some(a => a.weight === null)) return none('账号权重未知，无法估计')
  let points = 0; let sampleCount = 0; let requestCount = 0
  const intervals: [number, number][] = []
  try {
    for (const account of accounts) {
      if (++requestCount > 100) return none('历史请求达到100页上限，数据不全；请手填需求情景')
      let history: CodexQuotaHistoryResponse = await fetchCodexQuotaHistory(account.id, {}, signal)
      const weekly = history.windows.find(w => w.window_seconds === WEEK)
      if (!weekly) continue
      if (history.selected_window?.window_role !== weekly.window_role) {
        if (++requestCount > 100) return none('历史请求达到100页上限，数据不全；请手填需求情景')
        history = await fetchCodexQuotaHistory(account.id, { windowRole: weekly.window_role }, signal)
      }
      const cycles = [...history.cycles].sort((a,b) => Date.parse(b.effective_ended_at) - Date.parse(a.effective_ended_at))
      for (const cycle of cycles) {
        if (cycle.window_seconds !== WEEK) continue
        for (const t of cycle.transitions) {
          if (sampleCount >= 30) return none('近7天额度区间超过30个采样上限；请手填需求情景')
          const start = asMs(t.interval_started_at), end = asMs(t.interval_ended_at)
          if (start === null || end === null || start < Date.now() - 7 * 86400000 || end <= start || !Number.isFinite(t.percentage_points) || t.percentage_points <= 0) continue
          sampleCount++
          // Fetch ALL models to detect mixed and missing-effort requests.
          const events: UsageEvent[] = []; let cursor: string | undefined
          const seen = new Set<string>(); let complete = false
          for (let page = 0; page < 20; page++) {
            if (++requestCount > 100) return none('历史请求达到100页上限，数据不全；请手填需求情景')
            const response = await fetchUsageEvents({ range: 'custom', start: t.interval_started_at, end: new Date(end + 1).toISOString() }, signal, { source: account.id, cursorMode: true, cursor, pageSize: 100 })
            for (const event of response.events) {
              if (!event.id || seen.has(event.id)) continue
              seen.add(event.id); events.push(event)
            }
            if (response.has_more === false || (response.has_more === undefined && !response.next_cursor && response.total_pages <= 1)) { complete = true; break }
            if (!response.next_cursor || response.next_cursor === cursor) break
            cursor = response.next_cursor
          }
          if (!complete) return none('历史分页未完成，不能使用截断样本；请手填需求情景')
          const inRange = events.filter(e => { const at = asMs(e.timestamp); return at !== null && at > start && at <= end })
          if (inRange.length === 0 || inRange.length !== t.usage.requests || inRange.some(e => e.auth_index !== account.id || e.model !== model || e.reasoning_effort !== effort || e.isDelete)) continue
          points += t.percentage_points * account.weight!
          intervals.push([start, end])
        }
      }
    }
  } catch (e) { fatal(e); return none('历史数据读取失败，请手填需求情景') }
  if (!intervals.length) return none('没有同模型、同 effort 的纯净完整额度变化区间；请手填需求情景')
  // Union wall-clock coverage: simultaneous account samples do not add days twice.
  intervals.sort((a,b) => a[0]-b[0]); let duration = 0; let [start,end] = intervals[0]
  for (const [a,b] of intervals.slice(1)) { if (a <= end) end = Math.max(end,b); else { duration += end-start; start=a; end=b } }
  duration += end-start
  return { dailyDemand: points / (duration / 86400000), message: '来自近7天最多30个纯净完整区间的加权周百分点；历史限额可能压低需求，仅用于情景预测' }
}
