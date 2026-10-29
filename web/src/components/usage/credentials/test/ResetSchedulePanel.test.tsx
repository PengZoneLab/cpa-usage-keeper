// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResetSchedulePanel } from '../ResetSchedulePanel'
import { resetScheduleRequest, type ResetSchedule } from '@/lib/resetSchedule'
vi.mock('@/lib/resetSchedule', () => ({ resetScheduleRequest: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const initial: ResetSchedule = { auto_before_expiry: false, credits: [{ id: 'card/one', status: 'available', expiresAt: '2099-11-01T12:00:00Z' }], tasks: [], checked_at: null, error: '' }
const button = (key: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((el) => el.textContent === `reset_schedule.${key}`)!
const input = () => document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!
async function change(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
describe('account reset schedule', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    vi.mocked(resetScheduleRequest).mockReset().mockResolvedValue(initial)
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })
  const render = async () => { await act(async () => root.render(<ResetSchedulePanel authIndex="disabled-account" />)) }
  it('defaults off, reads without mutation and works independently of dispatch', async () => {
    await render()
    expect(resetScheduleRequest).toHaveBeenCalledExactlyOnceWith('disabled-account')
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.checked).toBe(false)
    expect(checkbox.disabled).toBe(false)
    vi.mocked(resetScheduleRequest).mockResolvedValue({ ...initial, auto_before_expiry: true })
    await act(async () => checkbox.click())
    expect(resetScheduleRequest).toHaveBeenNthCalledWith(2, 'disabled-account', { auto_before_expiry: true })
    expect(resetScheduleRequest).toHaveBeenLastCalledWith('disabled-account')
    expect(checkbox.checked).toBe(true)
  })
  it('schedules an exact card with an absolute timestamp and rereads', async () => {
    await render()
    await change('2099-10-30T14:20')
    await act(async () => button('save').click())
    expect(resetScheduleRequest).toHaveBeenNthCalledWith(2, 'disabled-account', { credit_id: 'card/one', scheduled_at: new Date('2099-10-30T14:20').toISOString() })
    expect(resetScheduleRequest).toHaveBeenLastCalledWith('disabled-account')
    expect(document.querySelector('form')).toBeNull()
  })
  it('modifies and cancels only the selected pending card', async () => {
    const scheduled = { ...initial, tasks: [{ credit_id: 'card/one', scheduled_at: '2099-10-30T12:00:00Z', expires_at: initial.credits[0].expiresAt, state: 'pending', source: 'scheduled' as const, result_code: '', attempts: 0, updated_at: '' }] }
    vi.mocked(resetScheduleRequest).mockResolvedValue(scheduled)
    await render()
    await change('2099-10-30T14:20')
    await act(async () => button('save').click())
    expect(resetScheduleRequest).toHaveBeenNthCalledWith(2, 'disabled-account', { credit_id: 'card/one', scheduled_at: new Date('2099-10-30T14:20').toISOString() })
    await act(async () => button('cancel').click())
    expect(resetScheduleRequest).toHaveBeenNthCalledWith(4, 'disabled-account', { credit_id: 'card/one', scheduled_at: null })
  })
  it('does not turn a failed load into a disabled policy', async () => {
    vi.mocked(resetScheduleRequest).mockRejectedValue(new Error('offline'))
    await render()
    expect(document.querySelector('input')).toBeNull()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('load_failed')
    vi.mocked(resetScheduleRequest).mockResolvedValue({ ...initial, auto_before_expiry: true })
    await act(async () => button('refresh').click())
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true)
  })
  it('blocks invalid time and ambiguous save until a successful refresh', async () => {
    await render()
    await change('2000-01-01T12:00')
    expect(button('save').disabled).toBe(true)
    await change('2099-12-01T12:00')
    expect(button('save').disabled).toBe(true)
    await change('2099-10-30T12:00')
    vi.mocked(resetScheduleRequest).mockRejectedValue(new Error('offline'))
    await act(async () => button('save').click())
    expect(input().disabled).toBe(true)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('save_failed')
    expect(input().value).toBe('2099-10-30T12:00')
  })
  it('shows uncertain outcomes and prevents resubmission', async () => {
    vi.mocked(resetScheduleRequest).mockResolvedValue({ ...initial, tasks: [{ credit_id: 'card/one', scheduled_at: '2099-10-30T12:00:00Z', expires_at: initial.credits[0].expiresAt, state: 'uncertain', source: 'scheduled', result_code: 'timeout', attempts: 1, updated_at: '' }] })
    await render()
    expect(input().disabled).toBe(true)
    expect(document.body.textContent).toContain('state_uncertain')
    expect(document.body.textContent).toContain('timeout')
  })
})
