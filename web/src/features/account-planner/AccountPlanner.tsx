import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ApiError } from '@/lib/api'
import type { PlannerAccount, PlannerResult } from './types'
import { runPlanner } from './runner'
import { loadPlannerSnapshot, refreshPlannerAccounts } from './data'
import { automaticPlannerInput, automaticAssumptions } from './automatic'
import styles from './AccountPlanner.module.scss'

export function AccountPlanner({ onAuthRequired }: { onAuthRequired?: () => void }) {
  const [accounts, setAccounts] = useState<PlannerAccount[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [result, setResult] = useState<PlannerResult | null>(null)
  const [resultOpen, setResultOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(true)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [respectProtection, setRespectProtection] = useState(false)
  const revision = useRef(0)
  const job = useRef<ReturnType<typeof runPlanner> | null>(null)
  const snapshotRequest = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const quotaRequest = useRef<AbortController | null>(null)
  const invalidate = useCallback(() => {
    revision.current++
    job.current?.cancel()
    quotaRequest.current?.abort()
    quotaRequest.current = null
    job.current = null
    setBusy(false)
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
      setSelected(previous => previous.filter(id => snapshot.accounts.some(a => a.id === id)))
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
    return () => { mounted.current = false; job.current?.cancel(); quotaRequest.current?.abort(); snapshotRequest.current?.abort() }
  }, [load])
  const selectedAccounts = useMemo(() => accounts.filter(a => selected.includes(a.id)), [accounts, selected])
  const name = (id: string) => accounts.find(a => a.id === id)?.name ?? id
  const date = (time: number | null | undefined) => typeof time !== 'number' || !Number.isFinite(time) ? '未知' : new Date(time).toLocaleString('zh-CN', { hour12: false })
  const toggle = (id: string, checked: boolean) => { invalidate(); setSelected(v => checked ? [...v, id] : v.filter(value => value !== id)) }
  const selectAll = () => { invalidate(); setSelected(accounts.map(a => a.id)) }
  const invertSelection = () => { invalidate(); setSelected(accounts.filter(a => !selected.includes(a.id)).map(a => a.id)) }
  const clearSelection = () => { invalidate(); setSelected([]) }
  const calculate = async () => {
    invalidate()
    setError('')
    const id = revision.current
    try {
      setBusy(true)
      let targets = selectedAccounts
      if (targets.some(a => a.issues.some(issue => /cache|缓存|重置时间已过/.test(issue)))) {
        const controller = new AbortController()
        quotaRequest.current = controller
        const snapshot = await refreshPlannerAccounts(targets.map(a => a.id), controller.signal)
        if (!mounted.current || controller.signal.aborted || id !== revision.current) return
        setAccounts(snapshot.accounts)
        targets = snapshot.accounts.filter(a => selected.includes(a.id))
      }
      job.current = runPlanner(automaticPlannerInput(targets, respectProtection))
      const answer = await job.current.promise
      if (mounted.current && id === revision.current) { setResult({ ...answer, assumptions: [...automaticAssumptions(respectProtection), ...answer.assumptions] }); setResultOpen(true) }
    } catch (e) {
      if (mounted.current && id === revision.current && !(e instanceof DOMException && e.name === 'AbortError')) { if (e instanceof ApiError && e.status === 401) onAuthRequired?.(); setError(String(e)) }
    } finally {
      if (mounted.current && id === revision.current) { job.current = null; setBusy(false) }
    }
  }
  const winner = result?.ranking[0]
  const winnerAccount = winner ? accounts.find(a => a.id === winner.accountId) : null
  return <section className={styles.page} aria-labelledby="planner-title">
    <header className={styles.header}>
      <div><h1 id="planner-title">账号优先规划</h1><p className={styles.muted}>选择账号，预览信息，计算优先使用顺序。</p></div>
      <Button variant="secondary" onClick={() => void load()} disabled={loading}>重读账号信息</Button>
    </header>
    {loading && <p role="status" aria-busy="true">正在读取账号信息…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!loading && !accounts.length && <p>没有可用的 Codex 账号。请先同步账号。</p>}
    <details className={styles.panel} open={pickerOpen} onToggle={e => setPickerOpen(e.currentTarget.open)}>
      <summary id="planner-accounts">选择账号 <span className={styles.muted}>{selected.length}/{accounts.length}</span></summary>
      <div className={styles.bulkActions} aria-label="批量选择">
        <button type="button" onClick={selectAll} disabled={loading || selected.length === accounts.length}>全选</button>
        <button type="button" onClick={invertSelection} disabled={loading || !accounts.length}>反选</button>
        <button type="button" onClick={clearSelection} disabled={loading || !selected.length}>清空</button>
      </div>
      <div className={styles.accounts}>{accounts.map(a => <label className={styles.account} key={a.id}>
        <input type="checkbox" checked={selected.includes(a.id)} disabled={loading} onChange={e => toggle(a.id, e.target.checked)} />
        <span className={styles.accountBody}><strong>{a.name}</strong><span>{a.plan || '未知方案'} · 周剩余 {a.remainingPercent === null ? '未知' : `${a.remainingPercent}%`}</span><small>{a.disabled ? '当前停用，仍可选择模拟' : '当前启用'}{a.protectionActive ? ' · 停派保护生效（可选约束）' : ''}</small></span>
      </label>)}</div>
    </details>
    <section className={styles.preview} aria-labelledby="planner-preview">
      <h2 id="planner-preview">已选账号预览 <span className={styles.muted}>{selectedAccounts.length} 个</span></h2>
      <Button variant="secondary" onClick={() => setPreviewOpen(true)} disabled={!selectedAccounts.length}>查看预览</Button>
      {!selectedAccounts.length && <p className={styles.muted}>勾选账号后，在这里预览到期和刷新时间。</p>}
      <div className={styles.previewList}>{selectedAccounts.map(a => <article key={a.id} className={styles.previewItem}>
        <div className={styles.previewHeading}><strong>{a.name}</strong><button type="button" onClick={() => toggle(a.id, false)} aria-label={`移除 ${a.name}`}>移除</button></div>
        <dl><div><dt>账号到期</dt><dd>{date(a.accountExpiresAt)}</dd></div><div><dt>下次额度刷新</dt><dd>{date(a.resetAt)}</dd></div><div><dt>剩余周额度</dt><dd>{a.remainingPercent === null ? '未知' : `${a.remainingPercent}%`} · 权重 {a.weight ?? '未知'}</dd></div>
          <div><dt>重置卡到期</dt><dd>{a.cards.length ? a.cards.map((c, i) => <span className={styles.cardExpiry} key={c.id}>卡 {i + 1}：{date(c.expiresAt)}</span>) : '无可用重置卡'}</dd></div>
        </dl>
        {(a.disabled || a.protectionActive) && <small className={styles.muted}>当前停派状态不会限制勾选；是否计入计算由下方开关决定。</small>}
        {a.issues.length > 0 && <small className={styles.error}>{a.issues.join('；')}</small>}
      </article>)}</div>
    </section>
    <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={`已选账号预览（${selectedAccounts.length} 个）`} footer={<Button onClick={() => setPreviewOpen(false)}>关闭预览</Button>}>
        <div className={styles.modalBody}>{selectedAccounts.map(a => <article key={a.id} className={styles.previewItem}>
          <div className={styles.previewHeading}><strong>{a.name}</strong><button type="button" onClick={() => toggle(a.id, false)} aria-label={`移除 ${a.name}`}>移除</button></div>
          <dl><div><dt>账号到期</dt><dd>{date(a.accountExpiresAt)}</dd></div><div><dt>下次额度刷新</dt><dd>{date(a.resetAt)}</dd></div><div><dt>剩余周额度</dt><dd>{a.remainingPercent === null ? '未知' : `${a.remainingPercent}%`} · 权重 {a.weight ?? '未知'}</dd></div><div><dt>重置卡到期</dt><dd>{a.cards.length ? a.cards.map((c, i) => <span className={styles.cardExpiry} key={c.id}>卡 {i + 1}：{date(c.expiresAt)}</span>) : '无可用重置卡'}</dd></div></dl>
        </article>)}</div>
    </Modal>
    <label className={styles.check}><input type="checkbox" checked={respectProtection} onChange={e => { invalidate(); setRespectProtection(e.target.checked) }} />计算时考虑当前停派保护</label>
    <p className={styles.muted}>仅计算方案，不更改账号状态或使用重置卡。未知时间会如实标注。</p>
    {result && <Button variant="secondary" onClick={() => setResultOpen(true)}>查看推荐结果</Button>}
    <div className={styles.actions}><Button onClick={() => void calculate()} disabled={loading || busy || selected.length === 0} loading={busy}>{busy ? '计算中…' : '计算优先账号'}</Button>{busy && <Button variant="secondary" onClick={invalidate}>取消</Button>}</div>
    {result && <Modal open={resultOpen} onClose={() => setResultOpen(false)} title="账号优先推荐" footer={<Button onClick={() => setResultOpen(false)}>关闭推荐</Button>}><section className={styles.result} aria-live="polite">
      <h2>{winner ? `推荐账号：${name(winner.accountId)}` : '本次未得到账号推荐'}</h2>
      {winner && winnerAccount && <div className={styles.keyFactors} aria-label="推荐关键因素">
        <strong>为什么推荐</strong><p>先用此账号，当前情景可消耗 {winner.score.toFixed(2)} 个加权周百分点{result?.ranking[1] ? `，比下一名多 ${result.ranking[1].delta.toFixed(2)}` : ''}。</p>{result?.tied && <p>多个账号收益并列，这不是唯一最优账号。</p>}
        <div className={styles.factorGrid}>
          <span>剩余周额度 <b>{winnerAccount.remainingPercent === null ? '未知' : `${winnerAccount.remainingPercent}%`}</b></span>
          <span>额度权重 <b>{winnerAccount.weight ?? '未知'}</b></span>
          <span>下次刷新 <b>{date(winnerAccount.resetAt)}</b></span>
          <span>最近卡到期 <b>{winnerAccount.cards.length ? date(Math.min(...winnerAccount.cards.map(c => c.expiresAt))) : '无可用卡'}</b></span>
        </div>
        <p className={styles.muted}>这些因子共同进入计算：分别模拟先用每个账号，比较整个规划期内可消耗的加权周额度。账号到期时间不直接判定不可用。</p>
      </div>}
      <p role={result.status === 'optimal' ? 'status' : 'alert'}>{result.message}</p>
      <p className={styles.muted}>没有手填或预测真实需求。下面比较的是自动生成的容量消耗情景，不代表真实未来用量。</p>
      {winner && <>
        <p>情景内总量 <strong>{winner.score.toFixed(3)}</strong> · 领先第二名 {(result.ranking[1]?.delta ?? 0).toFixed(3)} 个加权周百分点</p>
        <details><summary>比较各账号方案</summary><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>账号</th><th>Qᵢ</th><th>本月</th><th>低需求</th><th>高需求</th><th>距首选差值</th></tr></thead><tbody>{result.ranking.map(r => <tr key={r.accountId}><th scope="row">{name(r.accountId)}</th><td>{r.score.toFixed(3)}</td><td>{r.monthScore.toFixed(3)}</td><td>{r.lowScore.toFixed(3)}</td><td>{r.highScore.toFixed(3)}</td><td>{r.delta.toFixed(3)}</td></tr>)}</tbody></table></div></details>
        <details><summary>使用计划</summary><ol className={styles.plan}>{winner.actions.map((a, k) => <li key={k}><time>{date(a.at)} – {date(a.end)}</time><span>{name(a.accountId)} · {a.cardId ? '模拟用卡并等待人工恢复' : `${a.consumed.toFixed(3)} 个加权周百分点`}</span></li>)}</ol></details>
      </>}
      <details><summary>为什么推荐这个账号</summary><p className={styles.formula}>Qᵢ = max Σ wⱼcⱼₜ（先使用账号 i）；i* = arg max Qᵢ</p><p>5x 权重1，20x权重2。只计算实际消耗，不把恢复库存直接算成收益。</p><ul>{result.assumptions.map(a => <li key={a}>{a}</li>)}</ul></details>
    </section></Modal>}
  </section>
}
