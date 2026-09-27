import { useEffect, useMemo, useRef, useState } from 'react'
import type { UsageEvent } from '@/lib/types'
import { fetchUsageEventRequestLog } from '@/lib/api'
import { compareRequests, groupRequests, promptPreview } from './promptPreview'
import styles from './RequestBrowser.module.scss'

let active = 0
const pending: (() => void)[] = []
function schedule(run: () => Promise<void>) {
  const start = () => { active++; void run().finally(() => { active--; pending.shift()?.() }) }
  if (active < 4) start(); else pending.push(start)
}
function RequestRow({ event, onOpen, cache }: { event: UsageEvent; onOpen?: (event: UsageEvent) => void; cache: Map<string, string> }) {
  const element = useRef<HTMLButtonElement>(null)
  const [preview, setPreview] = useState(event.id && cache.get(event.id) || '正在加载 Prompt…')
  useEffect(() => {
    const controller = new AbortController()
    if (event.id && cache.has(event.id)) return
    let started = false
    const observer = new IntersectionObserver(entries => {
      if (started || !entries.some(entry => entry.isIntersecting)) return
      started = true
      observer.disconnect()
      schedule(async () => {
        if (controller.signal.aborted) return
        if (!event.id) { setPreview('没有可用的请求日志'); return }
        try {
          const result = await fetchUsageEventRequestLog(event.id, controller.signal)
          if (!controller.signal.aborted) {
            const text = promptPreview(result)
            if (cache.size >= 500) cache.delete(cache.keys().next().value!)
            cache.set(event.id, text)
            setPreview(text)
          }
        } catch { if (!controller.signal.aborted) setPreview('预览加载失败，点击查看详情') }
      })
    }, { rootMargin: '100px' })
    if (element.current) observer.observe(element.current)
    return () => { observer.disconnect(); controller.abort() }
  }, [event.id, cache])
  return <button ref={element} className={styles.row} onClick={() => onOpen?.(event)} aria-label={`查看请求 ${event.id ?? event.request_id ?? ''} 详情`}>
    <span className={styles.time}>{new Date(event.timestamp).toLocaleString()}<br />#{event.id}</span>
    <span className={styles.preview}>{preview}</span>
    <span className={styles.meta}>{event.model}<br />{event.failed ? '请求失败' : '请求成功'} · {event.stream ? '流式' : '非流式'}</span>
  </button>
}
function SessionGroup({ group, onOpen, cache }: { group: ReturnType<typeof groupRequests>[number]; onOpen?: (event: UsageEvent) => void; cache: Map<string, string> }) {
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(20)
  return <details className={styles.group} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>{group.label}<span>{group.requests.length} 条请求 · 最新 {new Date(group.requests[0].timestamp).toLocaleString()}</span></summary>
    {open && <>{group.requests.slice(0, limit).map(event => <RequestRow key={event.id ?? event.request_id} event={event} onOpen={onOpen} cache={cache} />)}
      {limit < group.requests.length && <button className={styles.more} onClick={() => setLimit(n => n + 20)}>显示更多请求</button>}</>}
  </details>
}
export function RequestBrowser({ events, loading, totalCount, hasMore, loadingMore, autoLoadMore, onLoadMore, onOpen }: {
  events: UsageEvent[]; loading: boolean; totalCount: number; hasMore: boolean; loadingMore: boolean; autoLoadMore: boolean; onLoadMore?: () => void; onOpen?: (event: UsageEvent) => void
}) {
  const [mode, setMode] = useState<'time' | 'session'>(() => {
    try { return sessionStorage.getItem('keeper-prompt-browser-mode') === 'time' ? 'time' : 'session' } catch { return 'session' }
  })
  const changeMode = (value: 'time' | 'session') => {
    setMode(value)
    try { sessionStorage.setItem('keeper-prompt-browser-mode', value) } catch { /* Storage can be unavailable in embedded contexts. */ }
    setLimit(20)
    attempt.current = ''
  }
  const [limit, setLimit] = useState(20)
  const attempt = useRef('')
  const [cache] = useState(() => new Map<string, string>())
  const sorted = useMemo(() => [...events].sort(compareRequests), [events])
  const groups = useMemo(() => groupRequests(events), [events])
  const signature = `${events.length}:${events[0]?.id}:${events.at(-1)?.id}`
  useEffect(() => {
    if (loading) { attempt.current = ''; return }
    if (mode !== 'session' || !hasMore || loading || loadingMore || !autoLoadMore || !onLoadMore) return
    if (attempt.current === signature) return
    attempt.current = signature
    onLoadMore()
  }, [mode, hasMore, loading, loadingMore, autoLoadMore, onLoadMore, signature])
  return <div className={styles.browser}>
    <div className={styles.toolbar}>
      <button aria-pressed={mode === 'time'} onClick={() => changeMode('time')}>全部请求</button>
      <button aria-pressed={mode === 'session'} onClick={() => changeMode('session')}>Session 视图</button>
      <span className={styles.note}>时间倒序 · Prompt 预览前 50 字 · 点击查看完整详情</span>
    </div>
    {loading ? <p role="status">正在加载请求…</p> : mode === 'session' && hasMore ? <div role="status">
      <p>正在归拢 Session：已加载 {events.length} / {totalCount} 条请求，完成后展示分组。</p>
      {!loadingMore && <button className={styles.more} onClick={onLoadMore}>继续加载</button>}
    </div> : events.length === 0 ? <p>当前筛选范围内没有请求。</p> : mode === 'session' ? <>
      <p className={styles.note}>{groups.length} 个分组 · {events.length} 条请求</p>
      {groups.slice(0, limit).map(group => <SessionGroup key={group.key} group={group} onOpen={onOpen} cache={cache} />)}
      {limit < groups.length && <button className={styles.more} onClick={() => setLimit(n => n + 20)}>显示更多 Session</button>}
    </> : <>
      {sorted.slice(0, limit).map(event => <RequestRow key={event.id ?? event.request_id} event={event} onOpen={onOpen} cache={cache} />)}
      {limit < sorted.length ? <button className={styles.more} onClick={() => setLimit(n => n + 20)}>显示更多请求</button> : hasMore && <button className={styles.more} disabled={loadingMore} onClick={() => { setLimit(n => n + 20); onLoadMore?.() }}>{loadingMore ? '加载中…' : '加载更多请求'}</button>}
      <p className={styles.note}>已加载 {events.length} / {totalCount} 条请求</p>
    </>}
  </div>
}
