import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { ApiError } from '@/lib/api'
import type { PlannerAccount, PlannerResult } from './types'
import { runPlanner } from './runner'
import { loadPlannerSnapshot, estimatePlannerDemand } from './data'
import styles from './AccountPlanner.module.scss'

export const plannerMonthEnd = (now = new Date()) => new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
export const plannerDate = (time: number) => {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const initialEnd = () => plannerDate(plannerMonthEnd() + 7 * 86400_000)
const supported = (a: PlannerAccount) => !a.disabled && a.weight !== null && a.issues.length === 0

export function AccountPlanner({ onAuthRequired }: { onAuthRequired?: () => void }) {
  const { t, i18n } = useTranslation()
  const english = (i18n.resolvedLanguage || i18n.language).startsWith('en')
  const text = (zh: string, en: string) => english ? en : zh
  const [accounts, setAccounts] = useState<PlannerAccount[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [result, setResult] = useState<PlannerResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [estimating, setEstimating] = useState(false)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [daily, setDaily] = useState('')
  const [uncertainty, setUncertainty] = useState('20')
  const [endDate, setEndDate] = useState(initialEnd)
  const [slotHours, setSlotHours] = useState('6')
  const [allowCards, setAllowCards] = useState(false)
  const [resume, setResume] = useState('10')
  const [demandSource, setDemandSource] = useState('')
  const [short, setShort] = useState<Record<string, string>>({})
  const revision = useRef(0)
  const job = useRef<ReturnType<typeof runPlanner> | null>(null)
  const estimateRequest = useRef<AbortController | null>(null)
  const snapshotRequest = useRef<AbortController | null>(null)
  const mounted = useRef(false)

  const invalidate = useCallback(() => {
    revision.current++
    job.current?.cancel()
    job.current = null
    estimateRequest.current?.abort()
    estimateRequest.current = null
    setBusy(false)
    setEstimating(false)
    setResult(null)
  }, [])

  const load = useCallback(async () => {
    invalidate()
    snapshotRequest.current?.abort()
    const controller = new AbortController()
    snapshotRequest.current = controller
    setLoading(true)
    setError('')
    try {
      const snapshot = await loadPlannerSnapshot(controller.signal)
      if (controller.signal.aborted || !mounted.current) return
      setAccounts(snapshot.accounts)
      setLoadedAt(snapshot.loadedAt)
      setSelected(snapshot.accounts.filter(supported).map(a => a.id))
      const dates = snapshot.accounts.flatMap(a => [a.resetAt ?? 0, ...a.cards.map(c => c.expiresAt)])
      const lastEvent = Math.max(plannerMonthEnd(), ...dates)
      setEndDate(plannerDate(Math.min(Date.now() + 61 * 86400_000, lastEvent + 7 * 86400_000)))
    } catch (e) {
      if (controller.signal.aborted || !mounted.current) return
      if (e instanceof ApiError && e.status === 401) onAuthRequired?.()
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoading(false)
    }
  }, [invalidate, onAuthRequired])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
      // The mounted flag and aborted requests reject late completions.
      job.current?.cancel()
      estimateRequest.current?.abort()
      snapshotRequest.current?.abort()
    }
  }, [load])

  const selectedAccounts = useMemo(() => accounts.filter(a => selected.includes(a.id)), [accounts, selected])
  const name = (id: string) => accounts.find(a => a.id === id)?.name ?? id
  const date = (time: number | null) => time === null ? text('未知', 'Unknown') : new Date(time).toLocaleString(i18n.language)
  const parameter = (setter: (v: string) => void, value: string) => { invalidate(); setter(value) }

  const estimate = async () => {
    invalidate()
    const id = revision.current
    const controller = new AbortController()
    estimateRequest.current = controller
    setEstimating(true)
    setError('')
    try {
      const value = await estimatePlannerDemand(selectedAccounts, model, effort, controller.signal)
      if (!mounted.current || controller.signal.aborted || revision.current !== id) return
      setDemandSource(value.message)
      if (value.dailyDemand !== null) setDaily(value.dailyDemand.toFixed(3))
    } catch (e) {
      if (!mounted.current || controller.signal.aborted || revision.current !== id) return
      if (e instanceof ApiError && e.status === 401) onAuthRequired?.()
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mounted.current && revision.current === id) setEstimating(false)
    }
  }

  const calculate = async () => {
    invalidate()
    setError('')
    const id = revision.current
    // Date input denotes the final included local day; next midnight is exclusive.
    const end = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? new Date(`${endDate}T00:00:00`) : new Date(NaN)
    end.setDate(end.getDate() + 1)
    try {
      job.current = runPlanner({ accounts: selectedAccounts, now: Date.now(), end: end.getTime(), monthEnd: plannerMonthEnd(),
        dailyDemand: Number(daily), uncertaintyPercent: Number(uncertainty), slotHours: Number(slotHours), model, effort,
        shortCapacity: Object.fromEntries(Object.entries(short).map(([k, v]) => [k, Number(v)])), allowCards, resumeDelayMinutes: Number(resume) })
      setBusy(true)
      const answer = await job.current.promise
      if (mounted.current && id === revision.current) setResult(answer)
    } catch (e) {
      if (mounted.current && id === revision.current && !(e instanceof DOMException && e.name === 'AbortError')) setError(String(e))
    } finally {
      if (mounted.current && id === revision.current) { job.current = null; setBusy(false) }
    }
  }

  const winner = result?.ranking[0]
  return <section className={styles.page} aria-labelledby="planner-title">
    <header className={styles.header}>
      <div><h1 id="planner-title">{t('planner.title')}</h1><p className={styles.muted}>{t('planner.description')}</p></div>
      <Button variant="secondary" onClick={() => void load()} disabled={loading}>{text('重读账号快照', 'Reload account snapshot')}</Button>
    </header>
    <p className={styles.meta}>{text('5x 满周 = 100；20x 满周 = 200 加权周百分点。', 'Full weekly quota: 5x = 100; 20x = 200 weighted points.')} {loadedAt && <span>{text('读取时间：', 'Loaded: ')}{date(loadedAt)}</span>}</p>
    {loading && <p role="status" aria-busy="true">{text('正在读取账号和保护配置…', 'Reading accounts and protection settings…')}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!loading && !accounts.length && <p>{text('没有可用的 Codex 账号。请先在认证文件中同步账号和额度。', 'No Codex accounts found. Sync accounts and quotas in Credentials first.')}</p>}
    <div className={styles.grid}>
      <section className={styles.panel} aria-labelledby="planner-accounts">
        <h2 id="planner-accounts">{t('planner.accounts')} <span className={styles.muted}>{selected.length}/{accounts.length}</span></h2>
        <div className={styles.accounts}>{accounts.map(a => <label className={styles.account} key={a.id}>
          <input type="checkbox" checked={selected.includes(a.id)} disabled={loading || !supported(a)} onChange={e => { invalidate(); setSelected(v => e.target.checked ? [...v, a.id] : v.filter(id => id !== a.id)) }} />
          <span className={styles.accountBody}><strong>{a.name}</strong> <span className={styles.muted}>{a.plan || text('未知方案', 'Unknown plan')} · {text('权重', 'Weight')} {a.weight ?? '—'}</span>
            <span>{text('周剩余', 'Weekly remaining')} {a.remainingPercent === null ? '—' : `${a.remainingPercent}%`} · {text('下次重置', 'Next reset')} {date(a.resetAt)}</span>
            <span className={styles.muted}>{a.shortWindowSeconds === null && text('上游未提供短窗；仅按周额度规划。 ', 'No short window supplied; weekly-only model. ')}{text('卡片', 'Cards')} {a.cards.length} · {text('停派时间', 'Stop dispatch')} {a.stopAt === null ? text('未设置', 'Not set') : date(a.stopAt)}</span>
            {a.cards.map((c, k) => <small key={c.id}>{text('卡', 'Card')} {k + 1} · {text('到期', 'Expires')} {date(c.expiresAt)}</small>)}
            {a.disabled && <span className={styles.error}>{text('账号已停用', 'Account disabled')}</span>}
            {a.issues.length > 0 && <span className={styles.error}>{a.issues.join('；')}</span>}
          </span>
        </label>)}</div>
      </section>
      <section className={styles.panel} aria-labelledby="planner-parameters">
        <h2 id="planner-parameters">{t('planner.parameters')}</h2>
        <div className={styles.form}>
          <label>{text('模型', 'Model')}<input value={model} onChange={e => { parameter(setModel, e.target.value); setDemandSource('') }} placeholder="gpt-…" /></label>
          <label>Effort<input value={effort} onChange={e => { parameter(setEffort, e.target.value); setDemandSource('') }} placeholder="high" /></label>
          <label>{text('每日需求（5x周百分点）', 'Daily demand (weighted weekly points)')}<input type="number" min="0" max="10000" value={daily} onChange={e => { parameter(setDaily, e.target.value); setDemandSource(text('手填情景需求', 'Manual scenario demand')) }} /></label>
          <div><Button variant="secondary" onClick={() => void estimate()} disabled={loading || estimating || !model || !effort || !selected.length}>{estimating ? text('估计中…', 'Estimating…') : text('从历史估计需求', 'Estimate from history')}</Button><p className={styles.muted}>{demandSource || text('尚无需求预测。历史不足时可填写情景需求。', 'No demand estimate. Enter a scenario if history is insufficient.')}</p></div>
          <label>{text('不确定性 %', 'Demand uncertainty %')}<input type="number" min="0" max="99" value={uncertainty} onChange={e => parameter(setUncertainty, e.target.value)} /></label>
          <label>{text('结束时间', 'Final included date')}<input type="date" value={endDate} onChange={e => parameter(setEndDate, e.target.value)} /></label>
          <label>{text('时间槽（小时）', 'Decision grid (hours)')}<input type="number" min="1" max="24" value={slotHours} onChange={e => parameter(setSlotHours, e.target.value)} /></label>
        </div>
      </section>
    </div>
    <details className={styles.options} open>
      <summary>{text('短时额度与用卡场景', 'Short-window capacity and reset-card scenario')}</summary>
      <p className={styles.muted}>{text('短窗百分比与周额度基准不同。请填写短窗满额相当于多少加权周百分点；这属于情景假设。', 'Short-window percentages use a different capacity. Enter the weighted weekly points represented by a full short window; this is a scenario assumption.')}</p>
      <div className={styles.form}>{selectedAccounts.filter(a => a.shortWindowSeconds !== null).map(a => <label key={a.id}>{a.name}<input type="number" min="0" max="10000" value={short[a.id] ?? ''} placeholder={text('短窗满额对应的加权周百分点', 'Weighted points in a full short window')} onChange={e => { invalidate(); setShort(v => ({ ...v, [a.id]: e.target.value })) }} /></label>)}</div>
      <label className={styles.check}><input type="checkbox" checked={allowCards} onChange={e => { invalidate(); setAllowCards(e.target.checked) }} />{text('推演用卡后人工恢复：假设周额度及短窗恢复100%', 'Model manual resumption after card use, assuming both windows reset to 100%')}</label>
      <p className={styles.muted}>{text('只推演，不实际用卡或启用账号；现有停派截止始终有效。', 'Simulation only. No cards are consumed and no accounts are enabled. Existing stop deadlines remain binding.')}</p>
      {allowCards && <label className={styles.delay}>{text('恢复延迟（分钟）', 'Manual resume delay (minutes)')}<input type="number" min="1" max="1440" value={resume} onChange={e => parameter(setResume, e.target.value)} /></label>}
    </details>
    <div className={styles.actions}><Button onClick={() => void calculate()} disabled={loading || busy || selected.length === 0} loading={busy}>{busy ? text('计算中…', 'Calculating…') : text('计算优先账号', 'Calculate priority account')}</Button>{busy && <Button variant="secondary" onClick={invalidate}>{text('取消', 'Cancel')}</Button>}</div>
    {result && <section className={styles.result} aria-live="polite">
      <h2>{winner ? `${text('推荐账号：', 'Recommended account: ')}${name(winner.accountId)}` : text('本次未得到账号推荐', 'No recommendation available')}</h2>
      <p role={result.status === 'optimal' ? 'status' : 'alert'}>{result.message}</p>
      {winner && <>
        <p>{text('规划期总量', 'Planning horizon total')} <strong>{winner.score.toFixed(3)}</strong> · {text('本月剩余时间消耗', 'Remaining-month consumption')} {winner.monthScore.toFixed(3)} · {text('领先第二名', 'Margin over second place')} {(result.ranking[1]?.delta ?? 0).toFixed(3)} {text('加权周百分点', 'weighted points')}</p>
        <div className={styles.tableWrap}><table className={styles.table}><caption>{text('先使用每个账号时的最优总量', 'Optimal total when each account is used first')}</caption><thead><tr><th>{text('账号', 'Account')}</th><th>Qᵢ</th><th>{text('本月', 'This month')}</th><th>{text('低需求', 'Low demand')}</th><th>{text('高需求', 'High demand')}</th><th>{text('距首选差值', 'Gap to first')}</th></tr></thead><tbody>{result.ranking.map(r => <tr key={r.accountId}><th scope="row">{name(r.accountId)}</th><td>{r.score.toFixed(3)}</td><td>{r.monthScore.toFixed(3)}</td><td>{r.lowScore.toFixed(3)}</td><td>{r.highScore.toFixed(3)}</td><td>{r.delta.toFixed(3)}</td></tr>)}</tbody></table></div>
        <details><summary>{text('使用计划', 'Usage plan')}</summary><p className={styles.muted}>{text('时间段内的额度分配可顺序执行，不表示同时使用账号。用卡动作包含恢复延时。', 'Allocations within an interval can run sequentially. Card actions include the manual resume delay.')}</p><ol className={styles.plan}>{winner.actions.map((a, k) => <li key={k}><time>{date(a.at)} – {date(a.end)}</time><span>{name(a.accountId)} · {a.cardId ? text('用卡并等待人工恢复', 'Use card and await manual resume') : `${a.consumed.toFixed(3)} ${text('加权周百分点', 'weighted points')}`}</span></li>)}</ol></details>
      </>}
      <details open><summary>{text('公式与假设', 'Formula and assumptions')}</summary><p className={styles.formula}>Qᵢ = max<sub>π : first = i</sub> Σ<sub>t,j</sub> wⱼ cⱼₜ ; i* = arg max<sub>i</sub> Qᵢ</p><p>{text('比较完整使用计划；w₅ₓ=1，w₂₀ₓ=2，c为实际消耗的周额度百分点。自然重置和用卡只补充库存，不直接计为收益。', 'Compare complete plans: w₅ₓ=1, w₂₀ₓ=2, and c is consumed weekly percentage points. Resets replenish capacity; only consumption contributes to the objective.')}</p><ul>{result.assumptions.map(a => <li key={a}>{a}</li>)}</ul><p className={styles.muted}>{result.slots} {text('事件区间', 'event intervals')} · {(result.elapsedMs / 1000).toFixed(2)}s · {date(result.computedAt)}</p></details>
    </section>}
  </section>
}
