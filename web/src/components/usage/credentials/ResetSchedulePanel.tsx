import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { resetScheduleRequest, type ResetSchedule } from '@/lib/resetSchedule'
import styles from './ResetSchedulePanel.module.scss'

function localTime(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
}
const terminal = new Set(['running', 'succeeded', 'expired', 'unavailable', 'uncertain'])

export function ResetSchedulePanel({ authIndex }: { authIndex: string }) {
  const { t } = useTranslation()
  const [data, setData] = useState<ResetSchedule | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const lock = useRef(false)
  const accept = (value: ResetSchedule) => {
    setData(value)
    setDrafts(Object.fromEntries(value.tasks.map((task) => [task.credit_id, localTime(task.scheduled_at)])))
  }
  useEffect(() => {
    let active = true
    resetScheduleRequest(authIndex).then((value) => { if (active) { accept(value); setError('') } })
      .catch(() => { if (active) setError('load_failed') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [authIndex, revision])
  const update = async (change: Parameters<typeof resetScheduleRequest>[1]) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await resetScheduleRequest(authIndex, change)
      // 回读成功后才展示保存结果；失败时保留已知状态并阻止再次写入。
      accept(await resetScheduleRequest(authIndex))
      setNotice('saved')
    } catch { setError('save_failed') }
    finally { lock.current = false; setBusy(false) }
  }
  const disabled = busy || loading || !data || Boolean(error)
  const cards = data?.credits ?? []
  const orphanTasks = data?.tasks.filter((task) => !cards.some((card) => card.id === task.credit_id)) ?? []
  const format = (value: string) => new Date(value).toLocaleString()
  return <section className={styles.panel} aria-label={t('reset_schedule.title')} aria-busy={busy || loading}>
    <div className={styles.heading}><h3>{t('reset_schedule.title')}</h3>
      <Button type="button" variant="ghost" size="sm" disabled={busy || loading} onClick={() => { setLoading(true); setRevision((value) => value + 1) }}>{t('reset_schedule.refresh')}</Button>
    </div>
    <p className="hint">{t('reset_schedule.hint')}</p>
    {error && <p className="error-box" role="alert">{t(`reset_schedule.${error}`)}</p>}
    {data?.error && <p className="error-box" role="alert">{t('reset_schedule.upstream_error')}</p>}
    {!data && !error && <p role="status" className="hint">{t('common.loading')}</p>}
    {data && <>
      <label className={styles.policy}><input type="checkbox" checked={data.auto_before_expiry} disabled={disabled || (Boolean(data.error) && !data.auto_before_expiry)}
        onChange={(event) => void update({ auto_before_expiry: event.target.checked })} />
        <span>{t('reset_schedule.auto')}</span>
      </label>
      <p className="hint">{t('reset_schedule.timezone', { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
      {cards.length === 0 && <p className="hint">{t('reset_schedule.empty')}</p>}
      {cards.map((card) => {
        const task = data.tasks.find((item) => item.credit_id === card.id)
        const draft = drafts[card.id] ?? ''
        const timestamp = new Date(draft).getTime()
        const invalid = Boolean(draft) && (!Number.isFinite(timestamp) || timestamp < Date.now() + 3 * 60000 || timestamp >= new Date(card.expiresAt).getTime())
        const locked = disabled || terminal.has(task?.state ?? '') || card.status.toLowerCase() !== 'available' || new Date(card.expiresAt).getTime() <= Date.now()
        return <div key={card.id} className={styles.card}>
          <strong className={styles.identifier}>{t('reset_schedule.card', { id: card.id })}</strong>
          <p className="hint">{t('reset_schedule.expires', { time: format(card.expiresAt) })} · {card.status}</p>
          {task && <p role="status" className="hint">{t(`reset_schedule.state_${task.state}`, { defaultValue: task.state })} · {t(`reset_schedule.source_${task.source}`)}{task.updated_at && ` · ${format(task.updated_at)}`}{task.result_code && ` · ${task.result_code}`}</p>}
          <Input type="datetime-local" label={t('reset_schedule.at')} value={draft} disabled={locked}
            error={invalid ? t('reset_schedule.invalid') : undefined}
            onChange={(event) => setDrafts((current) => ({ ...current, [card.id]: event.target.value }))} />
          <div className={styles.actions}>
            <Button type="button" size="sm" variant="secondary" disabled={locked || !draft || invalid || draft === localTime(task?.scheduled_at)}
              onClick={() => void update({ credit_id: card.id, scheduled_at: new Date(draft).toISOString() })}>{t('reset_schedule.save')}</Button>
            {task?.scheduled_at && task.state === 'pending' && <Button type="button" size="sm" variant="ghost" disabled={disabled}
              onClick={() => void update({ credit_id: card.id, scheduled_at: null })}>{t('reset_schedule.cancel')}</Button>}
          </div>
        </div>
      })}
      {orphanTasks.map((task) => <p key={task.credit_id} className={styles.history}>{t('reset_schedule.card', { id: task.credit_id })} · {t(`reset_schedule.state_${task.state}`, { defaultValue: task.state })}{task.updated_at && ` · ${format(task.updated_at)}`}{task.result_code && ` · ${task.result_code}`}</p>)}
      {data.checked_at && <p className="hint">{t('reset_schedule.checked', { time: format(data.checked_at) })}</p>}
    </>}
    {notice && <p role="status" className="hint">{t(`reset_schedule.${notice}`)}</p>}
  </section>
}
