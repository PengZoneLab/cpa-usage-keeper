// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { UsageEvent } from '@/lib/types'
import { fetchUsageEventConversation } from '@/lib/api'
import { RequestBrowser, previewText, groupConversationTurns } from '../RequestBrowser'
vi.mock('@/lib/api', () => ({ fetchUsageEventConversation: vi.fn() }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); sessionStorage.clear() })
it('shows each request input and output directly, expands text and retains full detail action', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class {
    callback: (entries: { isIntersecting: boolean }[]) => void
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { this.callback = callback }
    observe() { this.callback([{ isIntersecting: true }]) }
    disconnect() {}
  })
  vi.mocked(fetchUsageEventConversation).mockResolvedValue({ available: true, input: '输入内容' + '文'.repeat(900) + '输入末尾', output: '工具调用：search\n返回结果正文', full_input: '{"messages":[]}', role_messages: [{ role: 'system', content: '系统规则测试' }, { role: 'developer', content: '开发者规则测试' }, { role: 'user', content: '用户历史测试' }], input_available: true, output_available: true })
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const onOpen = vi.fn()
  try {
    const event = { id: '2', timestamp: '2026-09-27T00:00:00Z', session_id: 'session-a', session_metadata_available: true } as UsageEvent
    await act(async () => root.render(<RequestBrowser events={[event]} totalCount={1} loading={false} hasMore={false} loadingMore={false} autoLoadMore={false} onOpen={onOpen} />))
    expect(fetchUsageEventConversation).not.toHaveBeenCalled()
    await act(async () => { const detail = container.querySelector('details')!; detail.open = true; detail.dispatchEvent(new Event('toggle', { bubbles: true })) })
    expect(fetchUsageEventConversation).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('系统规则测试')
    expect(container.textContent).toContain('用户提示词')
    expect(container.textContent).toContain('模型返回')
    expect(container.textContent).toContain('工具调用：search')
    expect(container.textContent).not.toContain('输入末尾')
    await act(async () => { Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('展开完整输入'))!.click() })
    expect(container.textContent).toContain('输入末尾')
    await act(async () => root.render(<RequestBrowser events={[event]} totalCount={1} loading hasMore={false} loadingMore={false} autoLoadMore={false} onOpen={onOpen} />))
    expect(container.querySelector('details')?.open).toBe(true)
    expect(container.textContent).toContain('输入末尾')
    await act(async () => root.render(<RequestBrowser events={[{ ...event }]} totalCount={1} loading={false} hasMore={false} loadingMore={false} autoLoadMore={false} onOpen={onOpen} />))
    expect(container.querySelector('details')?.open).toBe(true)
    expect(container.textContent).toContain('输入末尾')
    expect(fetchUsageEventConversation).toHaveBeenCalledTimes(1)
    await act(async () => { const calls = container.querySelectorAll('details')[1]; calls.open = true; calls.dispatchEvent(new Event('toggle', { bubbles: true })) })
    await act(async () => { Array.from(container.querySelectorAll('button')).find(button => button.textContent === '完整入参与日志')!.click() })
    expect(onOpen).toHaveBeenCalledWith(event)
    const context = container.querySelectorAll('details')[2]
    await act(async () => { context.open = true; context.dispatchEvent(new Event('toggle', { bubbles: true })) })
    expect(container.textContent).toContain('模型返回')
    expect(fetchUsageEventConversation).toHaveBeenLastCalledWith('2', expect.any(AbortSignal), true)
    expect(container.querySelector('[data-message-role=system]')?.textContent).toContain('系统规则测试')
    expect(container.querySelector('[data-message-role=developer]')?.textContent).toContain('开发者规则测试')
    expect(container.querySelector('[data-message-role=user]')?.textContent).not.toContain('系统规则测试')
    await act(async () => { Array.from(container.querySelectorAll('button')).find(button => button.textContent === '原始入参')!.click() })
    expect(container.textContent).toContain('{"messages":[]}')
    vi.mocked(fetchUsageEventConversation).mockResolvedValue({ available: true, input: '新的问题', output: '刷新后的返回', full_input: '', input_available: true, output_available: true })
    await act(async () => { Array.from(container.querySelectorAll('button')).find(button => button.textContent === '刷新本组对话')!.click() })
    expect(container.textContent).toContain('刷新后的返回')
    expect(container.textContent).not.toContain('工具调用：search')
  } finally { await act(async () => root.unmount()); container.remove() }
})
it('keeps 50 unicode characters in compact preview without splitting emoji', () => {
  expect(previewText('😀'.repeat(51))).toBe('😀'.repeat(50) + '…')
  expect(previewText('短内容')).toBe('短内容')
})

it('groups only reliable keys within explicit sessions and keeps newest calls first', () => {
  const events = [1, 2, 3, 4].map(id => ({ id: String(id), timestamp: `2026-09-27T00:00:0${id}Z`, session_id: 'a', session_metadata_available: true } as UsageEvent))
  const item = { turn_confidence: 'user_history' as const, available: true, input: '重复问题', output: '回答', full_input: '', input_available: true, output_available: true }
  const data = new Map([['1', { ...item, turn_key: 'one' }], ['2', { ...item, turn_key: 'one', turn_continuation: true }], ['3', { ...item, turn_key: 'two' }], ['4', item]])
  const turns = groupConversationTurns(events, data)
  expect(turns.map(turn => turn.events.map(event => event.id))).toEqual([['4'], ['3'], ['2', '1']])
  expect(turns[0].reliable).toBe(false)
  data.set('2', { ...item, turn_key: 'one' })
  expect(groupConversationTurns(events, data)).toHaveLength(4)
  data.set('3', { ...item, turn_key: 'one', turn_continuation: true })
  data.delete('2')
  expect(groupConversationTurns(events, data)).toHaveLength(4)
  expect(groupConversationTurns(events.map(event => ({ ...event, session_id: undefined })), data)).toHaveLength(4)
})
