// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { UsageEvent } from '@/lib/types'
import { RequestBrowser } from '../RequestBrowser'

it('reloads an identical first page after filter refresh and hides incomplete groups', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const onLoadMore = vi.fn()
  const props = { events: [{ id: '1', timestamp: '2026-09-27T00:00:00Z', session_id: 'session-a', session_metadata_available: true } as UsageEvent], loading: false, totalCount: 100, hasMore: true, loadingMore: false, autoLoadMore: true, onLoadMore }
  try {
    await act(async () => root.render(<RequestBrowser {...props} />))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('完成后展示分组')
    expect(container.querySelector('details')).toBeNull()
    await act(async () => root.render(<RequestBrowser {...props} loading />))
    await act(async () => root.render(<RequestBrowser {...props} />))
    expect(onLoadMore).toHaveBeenCalledTimes(2)
    await act(async () => root.render(<RequestBrowser {...props} hasMore={false} />))
    expect(container.querySelector('summary')?.textContent).toContain('session-a')
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() }
})
