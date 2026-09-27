import { describe, expect, it } from 'vitest'
import type { UsageEvent, UsageEventRequestLogResponse } from '@/lib/types'
import { compareRequests, groupRequests, promptPreview } from '../promptPreview'
const event = (id: string, session_id?: string, timestamp = '2026-09-27T00:00:00Z') => ({ id, session_id, session_metadata_available: true, timestamp }) as UsageEvent
const log = (body: unknown) => ({ available: true, sections: [{ title: 'REQUEST BODY', content: JSON.stringify(body) }] }) as UsageEventRequestLogResponse

describe('request browser ordering and preview', () => {
  it('orders sessions by newest request and all children newest first', () => {
    const groups = groupRequests([event('2', 'a'), event('1', 'b'), event('3', 'b')])
    expect(groups.map(g => g.label)).toEqual(['b', 'a'])
    expect(groups[0].requests.map(e => e.id)).toEqual(['3', '1'])
  })
  it('preserves submillisecond timestamps before id tie break', () => {
    expect([event('99', 'a', '2026-09-27T00:00:00.000001Z'), event('1', 'a', '2026-09-27T00:00:00.000009Z')].sort(compareRequests)[0].id).toBe('1')
  })
  it('distinguishes absent metadata and genuinely unassociated sessions', () => {
    expect(groupRequests([event('1'), { ...event('2'), session_metadata_available: undefined }]).map(g => g.label)).toEqual(['Session 信息不可用', '未关联 Session'])
  })
  it('takes 50 Unicode characters of last user message without modifying source', () => {
    const body = { messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'old' }, { role: 'user', content: '😀'.repeat(51) }] }
    const data = log(body)
    expect(promptPreview(data)).toBe('😀'.repeat(50) + '…')
    expect(JSON.parse(data.sections[0].content)).toEqual(body)
  })
  it('handles structured multimodal input and malformed message entries', () => {
    expect(promptPreview(log({ input: [null, { role: 'user', content: [{ type: 'input_text', text: 'Hello' }, { type: 'input_image', image_url: 'image' }] }] }))).toBe('Hello')
    expect(promptPreview(log({ prompt: 'short' }))).toBe('short')
  })
})
