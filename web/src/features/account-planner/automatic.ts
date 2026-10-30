import type { PlannerAccount, PlannerInput } from './types'
const DAY = 86_400_000
/** No invented demand forecast: this is an explicitly labelled capacity scenario. */
export function automaticPlannerInput(accounts: PlannerAccount[], respectProtection: boolean, now = Date.now()): PlannerInput {
  const monthEnd = new Date(new Date(now).getFullYear(), new Date(now).getMonth() + 1, 1).getTime()
  const end = Math.min(now + 62 * DAY, Math.max(monthEnd, ...accounts.flatMap(a => [a.resetAt ?? now, ...a.cards.map(c => c.expiresAt)])) + 7 * DAY)
  return {
    accounts: accounts.map(a => {
      const issues = [...a.issues]
      if (respectProtection && a.protectionActive) issues.push('额度停派保护生效；可关闭保护约束进行模拟')
      if (a.shortWindowSeconds !== null) issues.push('上游还返回了短窗额度，当前无法自动换算；暂不生成最优结论')
      const deadlines = (respectProtection ? [a.stopAt] : []).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      return { ...a, issues, disabled: respectProtection && a.disabled, minimumPercent: respectProtection ? a.minimumPercent : 0, stopAt: deadlines.length ? Math.min(...deadlines) : null }
    }),
    now, monthEnd, end, dailyDemand: accounts.reduce((sum, a) => sum + 100 * (a.weight ?? 0), 0) / 7,
    uncertaintyPercent: 50, slotHours: 24, model: '用户已确认的同一模型', effort: '用户已确认的相同推理强度',
    shortCapacity: {}, allowCards: true, resumeDelayMinutes: 10, cardTiming: 'expiry',
  }
}
export const automaticAssumptions = (respect: boolean) => [
  '没有预测真实需求：基准按所选账号总周容量÷7均匀消耗，并比较50%与150%两种需求情景；结论仅适用于这些情景。',
  '重置卡仅按到期前10分钟使用推演，假设用卡恢复100%并在10分钟后人工恢复账号；本页不执行这些动作。',
  respect ? '已计入当前停用、额度下限和停派截止约束。' : '本次忽略当前停用和停派保护，只计算潜在使用方案；订阅到期仅作参考，不据此判定额度失效，实际状态不会改变。',
]
