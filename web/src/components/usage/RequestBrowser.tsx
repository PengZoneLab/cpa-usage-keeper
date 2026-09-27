import { useEffect, useMemo, useRef, useState } from 'react'
import type { UsageEvent } from '@/lib/types'
import { fetchUsageEventConversation, type UsageEventConversation } from '@/lib/api'
import { compareRequests, groupRequests } from './promptPreview'
import styles from './RequestBrowser.module.scss'

let active = 0
const pending: (() => void)[] = []
function schedule(run: () => Promise<void>) {
  const start = () => { active++; void run().finally(() => { active--; pending.shift()?.() }) }
  if (active < 4) start(); else pending.push(start)
}
const CACHE_BUDGET = 4 * 1024 * 1024
function storeConversation(cache: Map<string, UsageEventConversation>, id: string, value: UsageEventConversation) {
  // Keep readable bodies bounded; full original parameters remain available in the detail dialog.
  const size = (item: UsageEventConversation) => item.input.length + item.output.length + item.full_input.length
  if (size(value) > CACHE_BUDGET) return
  let total = [...cache.values()].reduce((sum, item) => sum + size(item), 0)
  while (cache.size && (cache.size >= 100 || total + size(value) > CACHE_BUDGET)) {
    const key = cache.keys().next().value!
    total -= size(cache.get(key)!)
    cache.delete(key)
  }
  cache.set(id, value)
}
export function previewText(text: string) {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim().slice(0, 102))
  return characters.slice(0, 50).join('') + (characters.length > 50 ? '…' : '')
}
function safeEnd(text: string, end: number) {
  const code = text.charCodeAt(end - 1)
  return code >= 0xd800 && code <= 0xdbff ? end - 1 : end
}
function ExpandableText({ text, label }: { text: string; label: string }) {
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(0)
  const long = text.length > 700
  const pageSize = 12000
  const pages = Math.ceil(text.length / pageSize)
  const shown = expanded ? text.slice(safeEnd(text, page * pageSize), safeEnd(text, (page + 1) * pageSize)) : long ? text.slice(0, safeEnd(text, 700)) + '…' : text
  return <><pre className={styles.body}>{shown}</pre>
    {long && <button className={styles.expand} aria-expanded={expanded} onClick={() => { setExpanded(value => !value); setPage(0) }}>{expanded ? '收起' : `展开完整${label}`}</button>}
    {expanded && pages > 1 && <nav className={styles.textPages} aria-label={`${label}全文分页`}><button disabled={page === 0} onClick={() => setPage(n => n - 1)}>上一段</button><span>全文第 {page + 1} / {pages} 段</span><button disabled={page + 1 === pages} onClick={() => setPage(n => n + 1)}>下一段</button></nav>}</>
}
function RequestContext({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return <details className={styles.context} onToggle={event => setOpen(event.currentTarget.open)}><summary>查看完整请求上下文与入参</summary>{open && <ExpandableText text={text} label="请求上下文" />}</details>
}
function RequestRow({ event, onOpen, cache, conversation = false }: { event: UsageEvent; onOpen?: (event: UsageEvent) => void; cache: Map<string, UsageEventConversation>; conversation?: boolean }) {
  const element = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<UsageEventConversation | undefined>(() => event.id ? cache.get(event.id) : undefined)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const cached = event.id ? cache.get(event.id) : undefined
    if (cached) return
    let started = false
    const observer = new IntersectionObserver(entries => {
      if (started || !entries.some(entry => entry.isIntersecting)) return
      started = true
      observer.disconnect()
      schedule(async () => {
        if (controller.signal.aborted) return
        if (!event.id) { setError('没有可用的请求日志'); return }
        try {
          const result = await fetchUsageEventConversation(event.id, controller.signal)
          if (!controller.signal.aborted) {
            storeConversation(cache, event.id, result)
            setData(result)
          }
        } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '对话加载失败') }
      })
    }, { rootMargin: '100px' })
    if (element.current) observer.observe(element.current)
    return () => { observer.disconnect(); controller.abort() }
  }, [event.id, cache, retry])
  const unavailable = data && !data.available ? '此请求的原始日志已不可用，无法还原输入与返回。' : ''
  const status = error || unavailable || (!data ? '正在加载对话…' : '')
  if (!conversation) return <div ref={element}><button className={styles.row} onClick={() => onOpen?.(event)} aria-label={`查看请求 ${event.id ?? event.request_id ?? ''} 详情`}>
    <span className={styles.time}>{new Date(event.timestamp).toLocaleString()}<br />#{event.id}</span>
    <span className={styles.preview}>{status || previewText(data?.input || '') || '没有文本 Prompt（查看详情）'}</span>
    <span className={styles.meta}>{event.model}<br />{event.failed ? '请求失败' : '请求成功'} · {event.stream ? '流式' : '非流式'}</span>
  </button></div>
  return <div ref={element} className={styles.conversation}>
    <header className={styles.requestHeader}><time>{new Date(event.timestamp).toLocaleString()}</time><span>{event.model} · {event.stream ? '流式' : '非流式'}{event.failed ? ' · 请求失败' : ''}</span><button onClick={() => onOpen?.(event)}>完整入参与日志</button></header>
    {status ? <div className={styles.status} role="status">{status}{error && <button className={styles.expand} onClick={() => { setError(''); setRetry(n => n + 1) }}>重试</button>}</div> : <div className={styles.exchange}>
      <section className={styles.input}><h4>输入 Prompt</h4><ExpandableText text={data?.input || '此请求没有用户文本（可能是工具结果或多模态输入）'} label="输入" />
        {data?.full_input && <RequestContext text={data.full_input} />}
      </section>
      <section className={styles.output}><h4>模型返回</h4><ExpandableText text={data?.output || '日志中没有模型返回正文'} label="返回" /></section>
    </div>}
  </div>
}
function SessionGroup({ group, onOpen, cache }: { group: ReturnType<typeof groupRequests>[number]; onOpen?: (event: UsageEvent) => void; cache: Map<string, UsageEventConversation> }) {
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(20)
  return <details className={styles.group} onToggle={e => { if (e.target === e.currentTarget) setOpen(e.currentTarget.open) }}>
    <summary><strong>{group.requests.length} 条请求</strong><span>最近活动 {new Date(group.requests[0].timestamp).toLocaleString()}</span><small>{group.label}</small></summary>
    {open && <>{group.requests.slice(0, limit).map(event => <RequestRow key={event.id ?? event.request_id} event={event} onOpen={onOpen} cache={cache} conversation />)}
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
  const [cache] = useState(() => new Map<string, UsageEventConversation>())
  const sorted = useMemo(() => [...events].sort(compareRequests), [events])
  // Preserve the last complete index while a background refresh pages in its replacement.
  // Updating derived state during render avoids an effect that clears the reading tree.
  const [completeEvents, setCompleteEvents] = useState<UsageEvent[] | null>(null)
  if (!loading && !hasMore && completeEvents !== events) setCompleteEvents(events)
  const groupEvents = completeEvents ?? events
  const groups = useMemo(() => groupRequests(groupEvents), [groupEvents])
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
      <span className={styles.note}>{mode === 'session' ? '时间倒序 · 展开 Session 阅读输入与模型返回' : '时间倒序 · Prompt 预览前 50 字 · 点击查看完整详情'}</span>
    </div>
    {loading && (events.length > 0 || completeEvents?.length) && <p className={styles.note} role="status">正在更新请求，当前阅读内容保持显示…</p>}
    {mode === 'session' && hasMore && completeEvents !== null && <p className={styles.note} role="status">正在更新 Session 索引：{events.length} / {totalCount} 条；完成前保留上次完整列表。</p>}
    {loading && events.length === 0 && !completeEvents?.length ? <p role="status">正在加载请求…</p> : mode === 'session' && hasMore && completeEvents === null ? <div role="status">
      <p>正在归拢 Session：已加载 {events.length} / {totalCount} 条请求，完成后展示分组。</p>
      {!loadingMore && <button className={styles.more} onClick={onLoadMore}>继续加载</button>}
    </div> : (mode === 'session' ? groupEvents.length : events.length) === 0 ? <p>当前筛选范围内没有请求。</p> : mode === 'session' ? <>
      <p className={styles.note}>{groups.length} 个分组 · {groupEvents.length} 条请求</p>
      {groups.slice(0, limit).map(group => <SessionGroup key={group.key} group={group} onOpen={onOpen} cache={cache} />)}
      {limit < groups.length && <button className={styles.more} onClick={() => setLimit(n => n + 20)}>显示更多 Session</button>}
    </> : <>
      {sorted.slice(0, limit).map(event => <RequestRow key={event.id ?? event.request_id} event={event} onOpen={onOpen} cache={cache} />)}
      {limit < sorted.length ? <button className={styles.more} onClick={() => setLimit(n => n + 20)}>显示更多请求</button> : hasMore && <button className={styles.more} disabled={loadingMore} onClick={() => { setLimit(n => n + 20); onLoadMore?.() }}>{loadingMore ? '加载中…' : '加载更多请求'}</button>}
      <p className={styles.note}>已加载 {events.length} / {totalCount} 条请求</p>
    </>}
  </div>
}
