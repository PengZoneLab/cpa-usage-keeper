import { apiFetch, apiPath, ApiError } from './api'

export interface QuotaFloor {
  minimum_percent: number | null
  dispatch_until?: string | null
  paused: boolean
  manual_hold: boolean
  remaining_percent: number | null
  checked_at: string | null
  state: string
}

export async function quotaFloorRequest(authIndex: string, minimum?: number | null, dispatchUntil?: string | null): Promise<QuotaFloor> {
  const response = await apiFetch(apiPath(`/credentials/${encodeURIComponent(authIndex)}/quota-floor`), minimum === undefined ? undefined : {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minimum_percent: minimum, dispatch_until: dispatchUntil }),
  })
  if (!response.ok) throw new ApiError('Quota limit request failed', response.status)
  return response.json()
}
