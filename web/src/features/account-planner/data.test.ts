import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { estimatePlannerDemand, loadPlannerSnapshot } from './data'
import { ApiError, fetchUsageIdentities, fetchUsageQuotaCache, fetchCodexQuotaHistory, fetchUsageEvents } from '@/lib/api'
import { quotaFloorRequest } from '@/lib/quotaFloor'
import { resetScheduleRequest } from '@/lib/resetSchedule'
import type { UsageIdentity, CodexQuotaHistoryResponse, UsageEvent, UsageEventsResponse } from '@/lib/types'
import type { PlannerAccount } from './types'
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<object>(), fetchUsageIdentities: vi.fn(), fetchUsageQuotaCache: vi.fn(), fetchCodexQuotaHistory: vi.fn(), fetchUsageEvents: vi.fn() }))
vi.mock('@/lib/quotaFloor', () => ({ quotaFloorRequest: vi.fn() }))
vi.mock('@/lib/resetSchedule', () => ({ resetScheduleRequest: vi.fn() }))
const now = Date.parse('2026-10-30T00:00:00Z')
const iso = (offset: number) => new Date(now + offset).toISOString()
const identity = (identity = 'a', plan = 'pro-20x') => ({ identity, name: identity, type:'codex', provider:'openai', auth_type:1, disabled:false, is_deleted:false, priority:1, subscription:{ provider:'codex', plan } } as UsageIdentity)
beforeEach(() => {
 vi.resetAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(now)
 vi.mocked(fetchUsageIdentities).mockResolvedValue({ identities: [identity()] })
 vi.mocked(fetchUsageQuotaCache).mockResolvedValue({ items:[{ auth_index:'a', status:'completed', refreshed_at:iso(0), quota:{ id:'a', quota:[{ key:'rate_limit.secondary_window', window:{seconds:604800}, usedPercent:50, resetAt:iso(86400000) },{ key:'code_review_rate_limit.primary_window', window:{seconds:18000}, usedPercent:99, resetAt:iso(30000) },{ key:'rate_limit.primary_window', window:{seconds:18000}, usedPercent:10, resetAt:iso(60000) }] } }] })
 vi.mocked(quotaFloorRequest).mockResolvedValue({minimum_percent:7, paused:false,manual_hold:false,remaining_percent:50,checked_at:iso(0),state:'watching',dispatch_until:iso(3600000)})
 vi.mocked(resetScheduleRequest).mockResolvedValue({auto_before_expiry:true,credits:[{id:'c',status:'available',expiresAt:iso(7200000)}],tasks:[],checked_at:iso(0),error:''})
})
afterEach(() => vi.restoreAllMocks())
describe('read-only snapshot', () => {
 it('loads all live credential codex identities, applies actual weight, and excludes review windows', async () => {
  vi.mocked(fetchUsageIdentities).mockResolvedValue({identities:[identity(),identity('b','pro-5x'),identity('unknown','pro'),{...identity('gone'),is_deleted:true},{...identity('ai'),auth_type:2}]})
  const s=await loadPlannerSnapshot()
  expect(s.accounts.map(a=>a.weight)).toEqual([2,1,null])
  expect(s.accounts[0]).toMatchObject({remainingPercent:50,shortRemainingPercent:90,shortWindowSeconds:18000,stopAt:now+3600000,minimumPercent:7})
  expect(fetchUsageQuotaCache).toHaveBeenCalledWith(['a','b','unknown'],undefined)
  expect(quotaFloorRequest).toHaveBeenCalledWith('a')
  expect(resetScheduleRequest).toHaveBeenCalledWith('a')
 })
 it('flags stale/missing observations and does not treat a nonweekly row as weekly', async () => {
  vi.mocked(fetchUsageQuotaCache).mockResolvedValue({items:[{auth_index:'a',status:'completed',refreshed_at:iso(-16*60000),quota:{id:'a',quota:[{key:'rate_limit.primary_window',window:{seconds:18000},usedPercent:1}]}}]})
  const a=(await loadPlannerSnapshot()).accounts[0]
  expect(a.remainingPercent).toBeNull(); expect(a.issues).toContain('quota cache expired')
 })
 it('propagates authorization failures instead of presenting a partial snapshot', async () => {
  const error=new ApiError('login',401); vi.mocked(quotaFloorRequest).mockRejectedValue(error)
  await expect(loadPlannerSnapshot()).rejects.toBe(error)
 })
 it('excludes unknown attempted cards and respects expired dispatch stops', async () => {
  vi.mocked(resetScheduleRequest).mockResolvedValue({auto_before_expiry:true,credits:[{id:'c',status:'available',expiresAt:iso(7200000)}],tasks:[{credit_id:'c',state:'unknown',attempts:1,result_code:'consume_result_unknown',scheduled_at:null,expires_at:iso(7200000),source:'expiry',updated_at:iso(0)}],checked_at:iso(0),error:''})
  vi.mocked(quotaFloorRequest).mockResolvedValue({minimum_percent:0,dispatch_until:iso(-60000),paused:false,manual_hold:false,remaining_percent:50,checked_at:iso(0),state:'watching'})
  const a=(await loadPlannerSnapshot()).accounts[0]; expect(a.cards).toEqual([]); expect(a.stopAt).toBe(now-60000)
 })
 it('does not block an account because a historical card succeeded', async () => {
  vi.mocked(resetScheduleRequest).mockResolvedValue({auto_before_expiry:false,credits:[{id:'old',status:'available',expiresAt:iso(7200000)}],tasks:[{credit_id:'old',state:'succeeded',attempts:1,result_code:'ok',scheduled_at:null,expires_at:iso(7200000),source:'scheduled',updated_at:iso(0)}],checked_at:iso(0),error:''})
  const a=(await loadPlannerSnapshot()).accounts[0]; expect(a.cards).toEqual([]); expect(a.issues).toEqual([])
 })
 it('preserves both dispatch deadlines and paused/manual hold protection', async () => {
  vi.mocked(quotaFloorRequest).mockResolvedValue({minimum_percent:0,dispatch_until:iso(3600000),reset_dispatch_until:iso(120000),paused:true,manual_hold:true,remaining_percent:50,checked_at:iso(0),state:'paused'} as Awaited<ReturnType<typeof quotaFloorRequest>>)
  const a=(await loadPlannerSnapshot()).accounts[0]; expect(a.stopAt).toBe(now+120000); expect(a.issues).toContain('额度停派保护生效')
 })
 it('flags active limits despite positive displayed remaining quota', async () => {
  const cache=await vi.mocked(fetchUsageQuotaCache)([]); cache.items[0].quota!.quota[0].allowed=false; cache.items[0].quota!.quota[2].limitReached=true
  const a=(await loadPlannerSnapshot()).accounts[0]; expect(a.issues).toContain('weekly quota currently limited'); expect(a.issues).toContain('短窗当前限流')
 })
 it('bounds account detail concurrency to eight accounts', async () => {
  vi.mocked(fetchUsageIdentities).mockResolvedValue({identities:Array.from({length:17},(_,i)=>identity(String(i)))})
  let active=0, peak=0
  const floor=await vi.mocked(quotaFloorRequest)('a')
  vi.mocked(quotaFloorRequest).mockImplementation(async()=>{ active++; peak=Math.max(peak,active); await new Promise(resolve=>setTimeout(resolve,1)); active--; return floor })
  await loadPlannerSnapshot(); expect(peak).toBeLessThanOrEqual(8); expect(peak).toBeGreaterThan(1)
 })
 it('scheduled card stop begins three minutes before execution', async () => {
  vi.mocked(resetScheduleRequest).mockResolvedValue({auto_before_expiry:false,credits:[],tasks:[{credit_id:'c',state:'pending',attempts:0,result_code:'',scheduled_at:iso(600000),expires_at:iso(7200000),source:'scheduled',updated_at:iso(0)}],checked_at:iso(0),error:''})
  expect((await loadPlannerSnapshot()).accounts[0].stopAt).toBe(now+420000)
 })
})
const accounts = [{id:'a',weight:1},{id:'b',weight:2}] as PlannerAccount[]
const history = { windows:[{window_role:'secondary',window_seconds:604800}],selected_window:{window_role:'secondary'},cycles:[{window_seconds:604800,transitions:[{interval_started_at:iso(-86400000),interval_ended_at:iso(0),percentage_points:10,usage:{requests:1}}]}] } as CodexQuotaHistoryResponse
const response = (auth_index:string, effort='high'): UsageEventsResponse => ({events:[{id:auth_index,timestamp:iso(-3600000),auth_index,model:'gpt',reasoning_effort:effort,failed:false} as UsageEvent],has_more:false,total_count:1,page:1,page_size:100,total_pages:1})
describe('historical demand', () => {
 it('weights pure transitions and unions simultaneous wall-clock days', async () => {
  vi.mocked(fetchCodexQuotaHistory).mockResolvedValue(history)
  vi.mocked(fetchUsageEvents).mockImplementation(async (_r,_s,o)=>response(o!.source!))
  expect((await estimatePlannerDemand(accounts,'gpt','high')).dailyDemand).toBe(30)
  expect(vi.mocked(fetchUsageEvents).mock.calls[0][2]?.model).toBeUndefined()
 })
 it('uses the backend left-open right-closed transition boundary', async () => {
  vi.mocked(fetchCodexQuotaHistory).mockResolvedValue(history)
  const result=response('a'); result.events[0].timestamp=iso(0)
  vi.mocked(fetchUsageEvents).mockResolvedValue(result)
  expect((await estimatePlannerDemand(accounts.slice(0,1),'gpt','high')).dailyDemand).toBe(10)
 })
 it('rejects mixed or unknown effort instead of assigning a quota proportion', async () => {
  vi.mocked(fetchCodexQuotaHistory).mockResolvedValue(history)
  vi.mocked(fetchUsageEvents).mockResolvedValue(response('a',''))
  expect((await estimatePlannerDemand(accounts.slice(0,1),'gpt','high')).dailyDemand).toBeNull()
 })
 it('does not estimate from capped or broken pagination', async () => {
  vi.mocked(fetchCodexQuotaHistory).mockResolvedValue(history)
  vi.mocked(fetchUsageEvents).mockResolvedValue({...response('a'),has_more:true,next_cursor:'same'})
  expect((await estimatePlannerDemand(accounts,'gpt','high')).dailyDemand).toBeNull()
 })
 it('returns explicit incomplete status at the interval cap', async () => {
  const many=structuredClone(history); many.cycles[0].transitions=Array.from({length:31},()=>structuredClone(history.cycles[0].transitions[0]))
  vi.mocked(fetchCodexQuotaHistory).mockResolvedValue(many); vi.mocked(fetchUsageEvents).mockResolvedValue(response('a'))
  const result=await estimatePlannerDemand(accounts.slice(0,1),'gpt','high'); expect(result.dailyDemand).toBeNull(); expect(result.message).toContain('30'); expect(fetchUsageEvents).toHaveBeenCalledTimes(30)
 })
 it('does not estimate when history event count disagrees', async () => {
  vi.mocked(fetchCodexQuotaHistory).mockResolvedValue(history)
  vi.mocked(fetchUsageEvents).mockResolvedValue({...response('a'),events:[]})
  expect((await estimatePlannerDemand(accounts,'gpt','high')).dailyDemand).toBeNull()
 })
})
