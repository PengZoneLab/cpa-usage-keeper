// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AccountPlanner, plannerDate, plannerMonthEnd } from './AccountPlanner'
import { loadPlannerSnapshot, estimatePlannerDemand } from './data'
import { runPlanner } from './runner'
import { ApiError } from '@/lib/api'
import type { PlannerAccount, PlannerResult } from './types'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('./data', () => ({ loadPlannerSnapshot: vi.fn(), estimatePlannerDemand: vi.fn() }))
vi.mock('./runner', () => ({ runPlanner: vi.fn() }))
vi.mock('react-i18next', () => ({ initReactI18next: {type: '3rdParty', init() {}}, useTranslation: () => ({ t: (k: string) => k, i18n: {language:'zh'} }) }))
let root: Root, host: HTMLDivElement
const auth = vi.fn()
const a: PlannerAccount = {id:'a',name:'Alpha',plan:'pro-5x',weight:1,priority:0,remainingPercent:50,resetAt:Date.now()+86400_000,observedAt:Date.now(),disabled:false,issues:[],cards:[],stopAt:null,minimumPercent:0,shortRemainingPercent:null,shortResetAt:null,shortWindowSeconds:null}
const result: PlannerResult = {status:'optimal',message:'tested',ranking:[{accountId:'a',score:80,monthScore:40,lowScore:60,highScore:100,delta:0,actions:[]}],stable:true,tied:false,computedAt:Date.now(),slots:3,assumptions:[],elapsedMs:1}
const button = (label:string) => [...host.querySelectorAll('button')].find(e => e.textContent===label)! as HTMLButtonElement
const field = (label:string) => [...host.querySelectorAll('label')].find(e => e.textContent===label)!.querySelector('input')!
async function change(label:string, value:string) { await act(async()=>{const el=field(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}) }
async function click(label:string) { await act(async()=>button(label).click()) }
async function render() { await act(async()=>root.render(<AccountPlanner onAuthRequired={auth}/>)) }
beforeEach(()=>{vi.resetAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.mocked(loadPlannerSnapshot).mockResolvedValue({accounts:[a],loadedAt:Date.now()});vi.mocked(runPlanner).mockReturnValue({promise:Promise.resolve(result),cancel:vi.fn()})})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
it('invalidates displayed results for every editable calculation input',async()=>{
 await render(); await click('计算优先账号'); expect(host.textContent).toContain('推荐账号：Alpha')
 await change('时间槽（小时）','12');expect(host.textContent).not.toContain('推荐账号：Alpha')
 await click('计算优先账号'); await change('结束时间','');expect(host.textContent).not.toContain('推荐账号：Alpha');expect(host.textContent).toContain('计算优先账号')
})
it('cancels work and ignores late results after a parameter change',async()=>{
 let resolve!:(r:PlannerResult)=>void;const cancel=vi.fn();vi.mocked(runPlanner).mockReturnValue({promise:new Promise(r=>resolve=r),cancel})
 await render();await click('计算优先账号');await change('模型','other');expect(cancel).toHaveBeenCalledOnce()
 await act(async()=>resolve(result));expect(host.textContent).not.toContain('推荐账号：Alpha')
})
it('aborts stale historical estimates and handles authorization failures',async()=>{
 let resolve!:(r:{dailyDemand:number|null;message:string})=>void
 vi.mocked(estimatePlannerDemand).mockReturnValue(new Promise(r=>resolve=r))
 await render();await change('模型','gpt');await change('Effort','high');await click('从历史估计需求')
 const signal=vi.mocked(estimatePlannerDemand).mock.calls[0][3]!
 await change('Effort','low');expect(signal.aborted).toBe(true)
 await act(async()=>resolve({dailyDemand:777,message:'stale'}));expect(field('每日需求（5x周百分点）').value).toBe('')
 vi.mocked(estimatePlannerDemand).mockRejectedValue(new ApiError('expired',401));await click('从历史估计需求');expect(auth).toHaveBeenCalledOnce();expect(host.textContent).toContain('expired')
})
it('reloads and rejects stale/unknown accounts without any mutations',async()=>{
 vi.mocked(loadPlannerSnapshot).mockResolvedValueOnce({accounts:[a,{...a,id:'b',name:'Unknown',weight:null,issues:['unknown']}],loadedAt:Date.now()})
 await render(); const boxes=host.querySelectorAll<HTMLInputElement>('input[type=checkbox]');expect(boxes[0].checked).toBe(true);expect(boxes[1].disabled).toBe(true)
 await click('重读账号快照');expect(loadPlannerSnapshot).toHaveBeenCalledTimes(2)
})
it('uses local dates and an exclusive next-month boundary',()=>{
 const local=new Date(2026,9,31,23,59,59,999)
 expect(plannerDate(local.getTime())).toBe('2026-10-31')
 expect(plannerMonthEnd(local)).toBe(new Date(2026,10,1).getTime())
})
it('renders empty/load-error states and propagates snapshot 401',async()=>{
 vi.mocked(loadPlannerSnapshot).mockRejectedValueOnce(new ApiError('expired',401));await render();expect(auth).toHaveBeenCalledOnce();expect(host.querySelector('[role=alert]')?.textContent).toBe('expired')
 vi.mocked(loadPlannerSnapshot).mockResolvedValueOnce({accounts:[],loadedAt:Date.now()});await click('重读账号快照');expect(host.textContent).toContain('没有可用的 Codex 账号')
})
