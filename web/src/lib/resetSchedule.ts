import { apiFetch, apiPath, ApiError } from './api'
import type { UsageQuotaResetCredit } from './types'

export interface ResetScheduleTask {
  credit_id: string
  scheduled_at: string | null
  expires_at: string
  state: string
  source: 'scheduled' | 'expiry'
  result_code: string
  attempts: number
  updated_at: string
}
export interface ResetSchedule {
  auto_before_expiry: boolean
  credits: UsageQuotaResetCredit[]
  tasks: ResetScheduleTask[]
  checked_at: string | null
  error: string
}
export async function resetScheduleRequest(authIndex: string, change?: { auto_before_expiry: boolean } | { credit_id: string; scheduled_at: string | null }): Promise<ResetSchedule> {
  const card = change && 'credit_id' in change ? `/cards/${encodeURIComponent(change.credit_id)}` : ''
  const body = change && 'credit_id' in change ? { scheduled_at: change.scheduled_at } : change
  const response = await apiFetch(apiPath(`/credentials/${encodeURIComponent(authIndex)}/reset-schedule${card}`), change ? {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined)
  if (!response.ok) throw new ApiError('Reset schedule request failed', response.status)
  return response.json()
}
