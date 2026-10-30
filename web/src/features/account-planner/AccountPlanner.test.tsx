// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AccountPlanner } from './AccountPlanner'
import { loadPlannerSnapshot, refreshPlannerAccounts } from './data'
import { runPlanner } from './runner'
import { ApiError } from '@/lib/api'
import type { PlannerAccount, PlannerResult } from './types'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('./data', () => ({ loadPlannerSnapshot: vi.fn(), refreshPlannerAccounts: vi.fn() }))
vi.mock('./runner', () => ({ runPlanner: vi.fn() }))
let root: Root, host: HTMLDivElement
const auth = vi.fn()
const now=Date.parse('2026-10-30T00:00:00Z')
const a: PlannerAccount={id:'a',name:'Alpha',plan:'pro-5x',weight:1,priority:0,remainingPercent:50,resetAt:now+86400_000,observedAt:now,disabled:true,protectionActive:true,issues:[],cards:[{id:'c1',expiresAt:now+2*86400_000},{id:'c2',expiresAt:now+3*86400_000}],stopAt:now-1000,minimumPercent:20,accountExpiresAt:now+10*86400_000,shortRemainingPercent:null,shortResetAt:null,shortWindowSeconds:null}
const result: PlannerResult={status:'optimal',message:'tested',ranking:[{accountId:'a',score:80,monthScore:40,lowScore:60,highScore:100,delta:0,actions:[]}],stable:true,tied:false,computedAt:now,slots:3,assumptions:[],elapsedMs:1}
const button=(label:string)=>[...host.querySelectorAll('button')].find(e=>e.textContent===label)! as HTMLButtonElement
async function click(label:string){await act(async()=>button(label).click())}
async function select(){await act(async()=>host.querySelector<HTMLInputElement>('.accounts input, #planner-accounts + div input')!.click())}
async function render(){await act(async()=>root.render(<AccountPlanner onAuthRequired={auth}/>))}
beforeEach(()=>{vi.resetAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.mocked(loadPlannerSnapshot).mockResolvedValue({accounts:[a],loadedAt:now});vi.mocked(runPlanner).mockReturnValue({promise:Promise.resolve(result),cancel:vi.fn()})})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
it('only exposes account selection and optional protection, without plan parameters',async()=>{await render();expect(host.querySelectorAll('input:not([type=checkbox])')).toHaveLength(0);expect(host.textContent).not.toContain('Plan parameters');expect(button('计算优先账号').disabled).toBe(true)})
it('allows stopped accounts and previews every distinct expiry and refresh time',async()=>{await render();await select();const preview=host.querySelector('[aria-labelledby=planner-preview]')!;expect(preview.textContent).toContain('Alpha');for(const label of ['账号到期','下次额度刷新','重置卡到期','卡 1','卡 2'])expect(preview.textContent).toContain(label);await click('计算优先账号');expect(runPlanner).toHaveBeenCalledOnce();expect(vi.mocked(runPlanner).mock.calls[0][0].accounts[0].disabled).toBe(false);expect(host.textContent).toContain('推荐账号：Alpha')})
it('enforces protection only when opted in and invalidates the old recommendation',async()=>{await render();await select();await click('计算优先账号');await act(async()=>{const labels=[...host.querySelectorAll('label')];labels.find(e=>e.textContent==='计算时考虑当前停派保护')!.querySelector<HTMLInputElement>('input')!.click()});expect(host.textContent).not.toContain('推荐账号：Alpha');await click('计算优先账号');expect(vi.mocked(runPlanner).mock.lastCall![0].accounts[0]).toMatchObject({disabled:true,minimumPercent:20})})
it('removing a selected account cancels work and prevents a late recommendation',async()=>{let resolve!:(r:PlannerResult)=>void;const cancel=vi.fn();vi.mocked(runPlanner).mockReturnValue({promise:new Promise(r=>resolve=r),cancel});await render();await select();await click('计算优先账号');await click('移除');expect(cancel).toHaveBeenCalledOnce();await act(async()=>resolve(result));expect(host.textContent).not.toContain('推荐账号：Alpha');expect(host.querySelectorAll('article')).toHaveLength(0)})
it('keeps missing expiry unknown, separate from the dispatch deadline',async()=>{vi.mocked(loadPlannerSnapshot).mockResolvedValue({accounts:[{...a,accountExpiresAt:null}],loadedAt:now});await render();await select();const row=[...host.querySelectorAll('dl > div')].find(el=>el.querySelector('dt')?.textContent==='账号到期');expect(row?.querySelector('dd')?.textContent).toBe('未知')})
it('preserves selection on reload and propagates authorization failures',async()=>{await render();await select();await click('重读账号信息');expect(host.querySelectorAll('article')).toHaveLength(1);vi.mocked(loadPlannerSnapshot).mockRejectedValue(new ApiError('expired',401));await click('重读账号信息');expect(auth).toHaveBeenCalledOnce();expect(host.querySelector('[role=alert]')?.textContent).toBe('expired')})

it('refreshes a stale selected snapshot before computing without enabling the account',async()=>{vi.mocked(loadPlannerSnapshot).mockResolvedValueOnce({accounts:[{...a,issues:['quota cache expired']}],loadedAt:now});vi.mocked(refreshPlannerAccounts).mockResolvedValue({accounts:[a],loadedAt:now});await render();await select();await click('计算优先账号');expect(refreshPlannerAccounts).toHaveBeenCalledWith(['a'],expect.any(AbortSignal));expect(runPlanner).toHaveBeenCalledOnce();expect(vi.mocked(runPlanner).mock.lastCall![0].accounts[0].disabled).toBe(false)})
