// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { UsageEvent } from '@/lib/types'
import { fetchUsageEventConversation } from '@/lib/api'
import { RequestBrowser, previewText } from '../RequestBrowser'
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
    expect(container.textContent).toContain('输入 Prompt')
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
    await act(async () => { Array.from(container.querySelectorAll('button')).find(button => button.textContent === '完整入参与日志')!.click() })
    expect(onOpen).toHaveBeenCalledWith(event)
    const context = container.querySelectorAll('details')[1]
    await act(async () => { context.open = true; context.dispatchEvent(new Event('toggle', { bubbles: true })) })
    expect(container.textContent).toContain('模型返回')
    expect(fetchUsageEventConversation).toHaveBeenLastCalledWith('2', expect.any(AbortSignal), true)
    expect(container.querySelector('[data-message-role=system]')?.textContent).toContain('系统规则测试')
    expect(container.querySelector('[data-message-role=developer]')?.textContent).toContain('开发者规则测试')
    expect(container.querySelector('[data-message-role=user]')?.textContent).not.toContain('系统规则测试')
    await act(async () => { Array.from(container.querySelectorAll('button')).find(button => button.textContent === '原始入参')!.click() })
    expect(container.textContent).toContain('{"messages":[]}')
  } finally { await act(async () => root.unmount()); container.remove() }
})
it('keeps 50 unicode characters in compact preview without splitting emoji', () => {
  expect(previewText('😀'.repeat(51))).toBe('😀'.repeat(50) + '…')
  expect(previewText('短内容')).toBe('短内容')
})
