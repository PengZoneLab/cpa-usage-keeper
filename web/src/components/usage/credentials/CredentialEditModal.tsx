import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useCredentialEnterSave } from './useCredentialEnterSave'
import { ResetSchedulePanel } from './ResetSchedulePanel'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { quotaFloorRequest, type QuotaFloor } from '@/lib/quotaFloor'
import { ApiError, setCredentialDisabled } from '@/lib/api'
import { parseCredentialPriority } from './CredentialPriorityEditor'
import { isCredentialStatusToggleSupported } from './CredentialStatusToggle'
import type { CredentialDetailSelection, CredentialEditChange } from './credentialViewModels'
import styles from './CredentialSections.module.scss'

function localDateTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19)
}

interface CredentialEditModalProps {
  selection: CredentialDetailSelection
  onClose: () => void
  onSaveField: (change: CredentialEditChange) => Promise<void>
  onSaved: () => void
  fallbackFocusRef?: RefObject<HTMLElement | null>
}

// 弹框挂在页面层，保存导致列表重新排序或过滤掉当前行时仍保留草稿。
export function CredentialEditModal({ selection, onClose, onSaveField, onSaved, fallbackFocusRef }: CredentialEditModalProps) {
  const { t } = useTranslation()
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fallback = fallbackFocusRef?.current
    // 页面会直接卸载编辑弹框；在公共 Modal 转移焦点之前记住入口，并在卸载时恢复。
    return () => {
      const target = opener?.isConnected ? opener : fallback
      target?.focus()
    }
  }, [fallbackFocusRef])
  const { identity, displayName } = selection.row
  const [saved, setSaved] = useState({ alias: identity.alias ?? '', priority: identity.priority ?? 0, disabled: identity.disabled ?? false })
  const [alias, setAlias] = useState(saved.alias)
  const [priority, setPriority] = useState(String(saved.priority))
  const [enabled, setEnabled] = useState(!saved.disabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [partial, setPartial] = useState(false)
  const [floor, setFloor] = useState<QuotaFloor | null>(null)
  const [minimum, setMinimum] = useState('')
  const [until, setUntil] = useState('')
  const [floorLoadError, setFloorLoadError] = useState(false)
  const [loadVersion, setLoadVersion] = useState(0)
  const authIndex = identity.identity
  useEffect(() => {
    if (selection.kind !== 'credential' || identity.is_deleted || !authIndex) return
    let active = true
    quotaFloorRequest(authIndex).then((policy) => {
      if (!active) return
      setFloor(policy)
      setUntil(localDateTime(policy.dispatch_until))
      setMinimum(policy.minimum_percent === null ? '' : String(policy.minimum_percent))
      setFloorLoadError(false)
    }).catch(() => { if (active) setFloorLoadError(true) })
    return () => { active = false }
  }, [selection.kind, authIndex, identity.is_deleted, loadVersion])
  const parsedMinimum = minimum.trim() === '' ? null : Number(minimum)
  const floorInvalid = parsedMinimum !== null && (!Number.isFinite(parsedMinimum) || parsedMinimum < 0 || parsedMinimum > 100)
  const untilInvalid = until !== '' && !Number.isFinite(new Date(until).getTime())
  const parsedUntil = until === '' || untilInvalid ? null : new Date(until).toISOString()
  const floorDirty = floor !== null && (parsedMinimum !== floor.minimum_percent || until !== localDateTime(floor.dispatch_until))
  const busyRef = useRef(false)
  const statusSupported = selection.kind === 'credential' || isCredentialStatusToggleSupported(identity.type)
  const readOnly = Boolean(identity.is_deleted)
  const parsedPriority = parseCredentialPriority(priority)
  const dirty = floorDirty || alias.trim() !== saved.alias.trim() || parsedPriority !== saved.priority || (statusSupported && !enabled !== saved.disabled)

  const save = async () => {
    if (busyRef.current || readOnly || !dirty) return
    if (untilInvalid) { setError(t('usage_stats.dispatch_until_invalid')); return }
    if (floorInvalid) { setError(t('usage_stats.quota_floor_invalid')); return }
    if (parsedPriority === null) { setError(t('usage_stats.credentials_priority_invalid')); return }
    const changes: CredentialEditChange[] = []
    if (alias.trim() !== saved.alias.trim()) changes.push({ field: 'alias', value: alias.trim() })
    if (parsedPriority !== saved.priority) changes.push({ field: 'priority', value: parsedPriority })
    if (statusSupported && !enabled !== saved.disabled) changes.push({ field: 'disabled', value: !enabled })
    busyRef.current = true
    setSaving(true)
    setError('')
    let completed = 0
    try {
      if (floorDirty) {
        const updated = await quotaFloorRequest(authIndex, parsedMinimum, parsedUntil)
        setFloor(updated)
        completed += 1
      }
      // 各字段使用现有独立接口，逐项记住成功结果；失败后只重试未保存部分。
      for (const change of changes) {
        await onSaveField(change)
        setSaved((current) => ({ ...current, [change.field]: change.value }))
        completed += 1
      }
      onSaved()
    } catch (cause) {
      setPartial((current) => current || completed > 0)
      const key = cause instanceof ApiError && cause.status === 404
        ? 'usage_stats.credentials_priority_stale_target'
        : cause instanceof ApiError && cause.status === 412
          ? 'usage_stats.credentials_config_changed'
          : cause instanceof ApiError && cause.status === 409
            ? selection.kind === 'credential' ? 'usage_stats.credentials_priority_conflict_credential' : 'usage_stats.credentials_edit_unsupported'
            : 'usage_stats.credentials_edit_failed'
      setError(cause instanceof ApiError && (cause.code === 'quota_floor_blocked' || cause.message.includes('quota_floor_blocked')) ? t('usage_stats.quota_floor_blocked') : t(key))
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  const enterSave = useCredentialEnterSave(save)

  return (
    <Modal open title={t('usage_stats.credentials_edit_title')} width={600} closeDisabled={saving}
      onClose={() => { if (!busyRef.current) onClose() }}
      footer={<>
        <Button variant="secondary" disabled={saving} onClick={onClose}>{t('common.cancel')}</Button>
        <Button loading={saving} disabled={!dirty || readOnly} onClick={() => void save()}>{t('common.save')}</Button>
      </>}>
      <form {...enterSave} className={styles.credentialEditForm} onSubmit={(event) => { event.preventDefault(); void save() }}>
        <p className={styles.credentialEditName}>{displayName}</p>
        <Input label={t('usage_stats.credentials_edit_alias')} value={alias} maxLength={50} disabled={saving || readOnly}
          placeholder={t('usage_stats.credentials_alias_placeholder')}
          hint={t('usage_stats.credentials_edit_alias_hint')} onChange={(event) => setAlias(event.target.value)} />
        <div className={styles.credentialEditStatusRow}>
          <span>{t('usage_stats.credentials_edit_status')}</span>
          <label className={`${styles.credentialActiveOnlySwitch} ${!statusSupported || saving || readOnly ? styles.credentialActiveOnlySwitchDisabled : ''}`}>
            <span className={styles.credentialActiveOnlyLabel}>{t(enabled ? 'usage_stats.credentials_edit_enabled' : 'usage_stats.credentials_edit_disabled')}</span>
            <input type="checkbox" checked={enabled} disabled={!statusSupported || saving || readOnly}
              aria-label={t('usage_stats.credentials_edit_status')} onChange={(event) => setEnabled(event.target.checked)} />
            <span className={styles.credentialActiveOnlyTrack} aria-hidden="true"><span className={styles.credentialActiveOnlyThumb} /></span>
          </label>
        </div>
        {!statusSupported && <p className="hint">{t('usage_stats.credentials_edit_unsupported')}</p>}
        <Input label={t('usage_stats.credentials_edit_priority')} type="text" value={priority} disabled={saving || readOnly}
          hint={t('usage_stats.credentials_priority_order_hint')} onChange={(event) => setPriority(event.target.value)} />
        {selection.kind === 'credential' && !readOnly && <>
          <Input label={t('usage_stats.quota_floor_label')} type="number" min={0} max={100} step="any" inputMode="decimal"
            value={minimum} placeholder={t('usage_stats.quota_floor_off')} disabled={saving || !floor}
            hint={t('usage_stats.quota_floor_hint')} error={floorInvalid ? t('usage_stats.quota_floor_invalid') : undefined}
            onChange={(event) => setMinimum(event.target.value)} />
          <Input label={t('usage_stats.dispatch_until_label')} type="datetime-local" step="1"
            value={until} disabled={saving || !floor} onChange={(event) => setUntil(event.target.value)}
            hint={t('usage_stats.dispatch_until_hint', { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
            error={untilInvalid ? t('usage_stats.dispatch_until_invalid') : undefined} />
          {floorLoadError ? <div role="alert" className="error-box">{t('usage_stats.quota_floor_load_failed')}
            <Button variant="secondary" onClick={() => { setFloorLoadError(false); setLoadVersion((value) => value + 1) }}>{t('common.retry')}</Button>
          </div> : !floor ? <p role="status" className="hint">{t('common.loading')}</p> : <>
            <p role="status" className="hint">{t(`usage_stats.quota_floor_state_${floor.state}`)}
              {floor.remaining_percent !== null && ` · ${t('usage_stats.quota_floor_remaining', { value: Number(floor.remaining_percent.toFixed(2)) })}`}
              {floor.checked_at && ` · ${new Date(floor.checked_at).toLocaleString()}`}
            </p>
            {floor.paused && !floor.manual_hold && <Button variant="secondary" disabled={saving} onClick={async () => {
              if (busyRef.current) return
              busyRef.current = true; setSaving(true); setError('')
              try {
                await setCredentialDisabled('credential', authIndex, true)
                setFloor({ ...floor, paused: false, manual_hold: true, state: 'manual' })
                setEnabled(false); setSaved((current) => ({ ...current, disabled: true }))
              } catch { setError(t('usage_stats.credentials_edit_failed')) }
              finally { busyRef.current = false; setSaving(false) }
            }}>{t('usage_stats.quota_floor_keep_disabled')}</Button>}
          </>}
        </>}
        {selection.kind === 'ai-provider' && identity.type.trim().toLowerCase() === 'openai' &&
          <p className="hint">{t('usage_stats.credentials_priority_openai_scope')}</p>}
        {partial && <p className={styles.credentialEditPartial} role="status">{t('usage_stats.credentials_edit_partial')}</p>}
        {error && <p className="error-box" role="alert">{error}</p>}
      </form>
      {selection.kind === 'credential' && identity.type.trim().toLowerCase() === 'codex' && !readOnly && <ResetSchedulePanel key={authIndex} authIndex={authIndex} />}
    </Modal>
  )
}
