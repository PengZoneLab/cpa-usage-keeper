import { beforeAll, expect, it } from 'vitest'
import loadHighs, {type Highs} from 'highs'
import {solveAccountPlan} from './solver'
import type {PlannerAccount,PlannerInput} from './types'
let highs:Highs
beforeAll(async()=>{highs=await loadHighs()})
const now=Date.parse('2026-10-30T00:00:00Z'),M=60000,H=60*M,D=24*H
const a=(id:string,o:Partial<PlannerAccount>={}):PlannerAccount=>({id,name:id,plan:'pro',weight:1,priority:0,remainingPercent:100,resetAt:now+7*D,observedAt:now,disabled:false,issues:[],cards:[],stopAt:null,minimumPercent:0,shortRemainingPercent:null,shortResetAt:null,shortWindowSeconds:null,...o})
const p=(accounts:PlannerAccount[],o:Partial<PlannerInput>={}):PlannerInput=>({accounts,now,end:now+D,monthEnd:now+12*H,dailyDemand:1000,uncertaintyPercent:0,slotHours:6,model:'m',effort:'high',shortCapacity:{},allowCards:false,resumeDelayMinutes:10,...o})
it('independent remaining stock bound',async()=>{const r=await solveAccountPlan(p([a('x',{remainingPercent:1})]),highs);expect(r.status).toBe('optimal');expect(r.ranking[0].score).toBeCloseTo(1)})
it('independent weighted reset closed form',async()=>{const r=await solveAccountPlan(p([a('x',{weight:2,remainingPercent:30,resetAt:now+4*H})]),highs);expect(r.status).toBe('optimal');expect(r.ranking[0].score).toBeCloseTo(260)})
it('independent seven-day recurring boundary',async()=>{const r=await solveAccountPlan(p([a('x',{remainingPercent:20,resetAt:now+H})],{end:now+8*D}),highs);expect(r.status).toBe('optimal');expect(r.ranking[0].score).toBeCloseTo(220)})
it('independent short capacity distinct from weekly',async()=>{const r=await solveAccountPlan(p([a('x',{weight:2,remainingPercent:50,shortRemainingPercent:50,shortWindowSeconds:18000,shortResetAt:now+5*H,stopAt:now+H})],{shortCapacity:{x:10}}),highs);expect(r.status).toBe('optimal');expect(r.ranking[0].score).toBeCloseTo(5)})
it('independent reset and card blackout joint case',async()=>{const r=await solveAccountPlan(p([a('x',{remainingPercent:20,resetAt:now+H,cards:[{id:'c',expiresAt:now+2*H}]})],{end:now+3*H,monthEnd:now+3*H,allowCards:true,dailyDemand:2400,slotHours:1}),highs);expect(r.status).toBe('optimal');expect(r.ranking[0].score).toBeLessThanOrEqual(220.00001);const cards=r.ranking[0].actions.filter(x=>x.cardId);expect(cards.length).toBeLessThanOrEqual(1);for(const c of cards)for(const x of r.ranking[0].actions.filter(x=>!x.cardId))expect(x.end<=c.at-3*M||x.at>=c.end).toBe(true)})
it('independent five-minute opportunity loss',async()=>{const r=await solveAccountPlan(p([a('soon',{stopAt:now+5*M}),a('later')],{dailyDemand:2880}),highs);expect(r.status).toBe('optimal');expect(r.ranking[0].accountId).toBe('soon');expect(r.ranking[0].score).toBeCloseTo(110);expect(r.ranking[1].score).toBeCloseTo(100)})
it('independent solver failure statuses',async()=>{for(const Status of ['Infeasible','Unbounded','Time limit reached']){const r=await solveAccountPlan(p([a('x')]),{solve:()=>({Status})} as unknown as Highs);expect(r.status).toBe('incomplete');expect(r.ranking).toEqual([])}})
it('independent twelve-account shared pool',async()=>{const r=await solveAccountPlan(p(Array.from({length:12},(_,i)=>a(String(i),{weight:i%2?2:1})),{dailyDemand:20}),highs);expect(r.status).toBe('optimal');expect(r.ranking).toHaveLength(12);for(const row of r.ranking)expect(row.score).toBeCloseTo(20)})
