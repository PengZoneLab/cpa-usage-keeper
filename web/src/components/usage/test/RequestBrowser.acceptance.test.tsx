// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { UsageEvent } from '@/lib/types'
import { RequestBrowser } from '../RequestBrowser'
let root: Root
let box: HTMLDivElement
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  box = document.createElement('div'); document.body.append(box); root = createRoot(box)
})
afterEach(async () => { await act(async () => root.unmount()); box.remove() })
it('keeps partial groups visible during refresh without automatic historical downloads', async () => {
  const onLoadMore = vi.fn()
  const events = [{ id: '2', timestamp: '2026-09-27T00:00:00Z', session_id: 'session-a', session_metadata_available: true }] as UsageEvent[]
  const render = async (loading: boolean, hasMore = true, autoLoadMore = true) => {
    await act(async () => root.render(<RequestBrowser events={events} loading={loading} totalCount={2} hasMore={hasMore} loadingMore={false} autoLoadMore={autoLoadMore} onLoadMore={onLoadMore} />))
  }
  await render(false)
  expect(onLoadMore).not.toHaveBeenCalled()
  expect(box.querySelector('details')).not.toBeNull()
  await render(false)
  expect(onLoadMore).not.toHaveBeenCalled()
  await render(true); await render(false)
  expect(onLoadMore).not.toHaveBeenCalled()
  await render(false, true, false)
  expect(onLoadMore).not.toHaveBeenCalled()
  await render(false, false)
  expect(box.querySelectorAll('details')).toHaveLength(1)
  expect(box.textContent).toContain('session-a')
})
