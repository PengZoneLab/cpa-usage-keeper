import { describe, expect, it } from 'vitest'
import { automaticPlannerInput } from './automatic'
import { buildPlannerModel, validatePlannerInput } from './solver'
import type { PlannerAccount } from './types'
const now=Date.parse('2026-10-30T00:00:00Z'),day=86400_000
const a:PlannerAccount={id:'a',name:'A',plan:'pro-5x',weight:1,priority:0,remainingPercent:60,resetAt:now+day,observedAt:now,disabled:true,protectionActive:true,issues:[],cards:[{id:'c',expiresAt:now+2*day}],stopAt:now-1,minimumPercent:20,accountExpiresAt:now+3*day,shortRemainingPercent:null,shortResetAt:null,shortWindowSeconds:null}
describe('automatic account-only planning',()=>{
 it('ignores dispatch only in simulation while preserving expiry and original object',()=>{const x=automaticPlannerInput([a],false,now);expect(x.accounts[0]).toMatchObject({disabled:false,minimumPercent:0,stopAt:now+3*day});expect(a.disabled).toBe(true);expect(a.stopAt).toBe(now-1);expect(validatePlannerInput(x)).toBeNull()})
 it('retains active protection when selected',()=>{expect(validatePlannerInput(automaticPlannerInput([a],true,now))).toContain('停用')})
 it('uses weighted capacity scenarios rather than claiming remaining quota predicts demand',()=>{const x=automaticPlannerInput([a,{...a,id:'b',weight:2,remainingPercent:10}],false,now);expect(x.dailyDemand).toBeCloseTo(300/7);expect(x.uncertaintyPercent).toBe(50)})
 it('never extends an expired subscription even with protection ignored',()=>{expect(validatePlannerInput(automaticPlannerInput([{...a,accountExpiresAt:now-1}],false,now))).not.toBeNull()})
 it('limits automatic card actions to the expiry deadline',()=>{const x=automaticPlannerInput([a],false,now);const m=buildPlannerModel(x,0);expect(m.choices).toHaveLength(1);expect(m.choices[0].time).toBe(a.cards[0].expiresAt-600000)})
 it('does not invent short-window conversion or missing quota',()=>{expect(validatePlannerInput(automaticPlannerInput([{...a,shortWindowSeconds:18000}],false,now))).toContain('自动换算');expect(validatePlannerInput(automaticPlannerInput([{...a,remainingPercent:null}],false,now))).toContain('缺失')})
})
