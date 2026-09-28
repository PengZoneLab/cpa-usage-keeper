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
const cachedAt = new WeakMap<UsageEventConversation, number>()
function getCached(cache: Map<string, UsageEventConversation>, id: string) {
  const value = cache.get(id)
  if (value && Date.now() - (cachedAt.get(value) ?? 0) < 15000) return value
  cache.delete(id)
  return undefined
}
const CACHE_BUDGET = 4 * 1024 * 1024
function storeConversation(cache: Map<string, UsageEventConversation>, id: string, value: UsageEventConversation) {
  // Keep readable bodies bounded; full original parameters remain available in the detail dialog.
  const size = (item: UsageEventConversation) => item.input.length + item.output.length + item.full_input.length
  if (!value.available || !value.output_available || size(value) > CACHE_BUDGET) return
  let total = [...cache.values()].reduce((sum, item) => sum + size(item), 0)
  while (cache.size && (cache.size >= 100 || total + size(value) > CACHE_BUDGET)) {
    const key = cache.keys().next().value!
    total -= size(cache.get(key)!)
    cache.delete(key)
  }
  cachedAt.set(value, Date.now())
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
const roleLabels: Record<string, string> = { system: '系统提示词', developer: '开发者提示词', user: '用户提示词', assistant: '历史模型回复', tool: '工具结果' }
function RoleMessage({ role, content }: { role: string; content: string }) {
  const tone = role === 'system' || role === 'developer' ? styles.system : role === 'assistant' ? styles.output : role === 'user' ? styles.input : styles.tool
  return <section className={`${styles.message} ${tone}`} data-message-role={role}><h4>{roleLabels[role] || role}</h4><ExpandableText text={content} label={roleLabels[role] || role} /></section>
}
function RequestContext({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<UsageEventConversation | null>(null)
  const [raw, setRaw] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [limit, setLimit] = useState(20)
  useEffect(() => {
    if (!open || data !== null) return
    const controller = new AbortController()
    void fetchUsageEventConversation(eventId, controller.signal, true).then(result => {
      if (!result.available || !result.full_input) throw new Error('没有可用的完整请求上下文，请稍后重试')
      setData(result)
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '上下文加载失败') })
    return () => controller.abort()
  }, [open, data, eventId, retry])
  const messages = data?.role_messages || []
  return <details className={styles.context} onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open) }}>
    <summary><span>系统提示词与历史上下文</span><span className={styles.contextHint}>按需加载</span></summary>
    {open && (data ? <div className={styles.contextContent}>
      <div className={styles.contextTabs} aria-label="上下文显示方式"><button aria-pressed={!raw} onClick={() => setRaw(false)}>按角色阅读</button><button aria-pressed={raw} onClick={() => setRaw(true)}>原始入参</button></div>
      {raw ? <ExpandableText text={data.full_input} label="原始入参" /> : <>
        <p className={styles.note}>完整请求历史 · 按原始顺序排列</p>
        {messages.length ? messages.slice(0, limit).map((message, index) => <RoleMessage key={index} {...message} />) : <p className={styles.note}>未识别到角色消息，可查看原始入参。</p>}
        {limit < messages.length && <button className={styles.more} onClick={() => setLimit(n => n + 20)}>继续阅读历史（{limit} / {messages.length}）</button>}
      </>}
    </div> : <div className={styles.status} role="status">{error || '正在加载完整上下文…'}{error && <button className={styles.expand} onClick={() => { setError(''); setRetry(n => n + 1) }}>重试加载上下文</button>}</div>)}
  </details>
}
function RequestRow({ event, onOpen, cache, conversation = false }: { event: UsageEvent; onOpen?: (event: UsageEvent) => void; cache: Map<string, UsageEventConversation>; conversation?: boolean }) {
  const element = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<UsageEventConversation | undefined>(() => event.id ? getCached(cache, event.id) : undefined)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const cached = event.id ? getCached(cache, event.id) : undefined
    if (cached) return
    let started = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const observer = new IntersectionObserver(entries => {
      if (started || !entries.some(entry => entry.isIntersecting)) return
      started = true
      observer.disconnect()
      timeout = setTimeout(() => { setError('加载超时，请重试'); controller.abort() }, 30000)
      schedule(async () => {
        if (controller.signal.aborted) return
        if (!event.id) { setError('没有可用的请求日志'); return }
        try {
          const result = await fetchUsageEventConversation(event.id, controller.signal)
          if (!controller.signal.aborted) {
            storeConversation(cache, event.id, result)
            setData(result)
          }
        } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '对话加载失败') } finally { clearTimeout(timeout) }
      })
    }, { rootMargin: '100px' })
    if (element.current) observer.observe(element.current)
    return () => { clearTimeout(timeout); observer.disconnect(); controller.abort() }
  }, [event.id, cache, retry])
  const unavailable = data && !data.available ? '此请求的原始日志已不可用，无法还原输入与返回。' : ''
  const retryButton = <button className={styles.expand} onClick={() => { if (event.id) cache.delete(event.id); setData(undefined); setError(''); setRetry(n => n + 1) }}>{data?.available && !error ? '刷新对话' : '重试'}</button>
  const status = error || unavailable || (!data ? '正在加载对话…' : '')
  if (!conversation) return <div ref={element}><button className={styles.row} onClick={() => onOpen?.(event)} aria-label={`查看请求 ${event.id ?? event.request_id ?? ''} 详情`}>
    <span className={styles.time}>{new Date(event.timestamp).toLocaleString()}<br />#{event.id}</span>
    <span className={styles.preview}>{status || previewText(data?.input || '') || '没有文本 Prompt（查看详情）'}</span>
    <span className={styles.meta}>{event.model}<br />{event.failed ? '请求失败' : '请求成功'} · {event.stream ? '流式' : '非流式'}</span>
  </button>{(error || unavailable) && retryButton}</div>
  return <div ref={element} className={styles.conversation}>
    <header className={styles.requestHeader}><time>{new Date(event.timestamp).toLocaleString()}</time><span>{event.model} · {event.stream ? '流式' : '非流式'}{event.failed ? ' · 请求失败' : ''}</span><button onClick={() => onOpen?.(event)}>完整入参与日志</button></header>
    {status ? <div className={styles.status} role="status">{status}{(error || unavailable) && retryButton}</div> : <div className={styles.exchange}>
      <section className={`${styles.message} ${styles.input}`} data-message-role="user"><h4>用户提示词 <small>本轮输入 Prompt</small></h4><ExpandableText text={data?.input || '此请求没有用户文本（可能是工具结果或多模态输入）'} label="输入" />
      </section>
      <section className={`${styles.message} ${styles.output}`} data-message-role="assistant"><div className={styles.messageHeading}><h4>模型返回</h4>{retryButton}</div><ExpandableText text={data?.output || '日志中没有模型返回正文'} label="返回" /></section>
    </div>}
    {data?.available && event.id && <RequestContext eventId={event.id} />}
  </div>
}
function SessionGroup({ group, onOpen, cache }: { group: ReturnType<typeof groupRequests>[number]; onOpen?: (event: UsageEvent) => void; cache: Map<string, UsageEventConversation> }) {
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(20)
  return <details className={styles.group} onToggle={e => { if (e.target === e.currentTarget) setOpen(e.currentTarget.open) }}>
    <summary className={styles.sessionSummary}><span className={styles.sessionIcon} aria-hidden="true">↳</span><span className={styles.sessionTitle}><strong>{group.key.startsWith('session:') ? (group.requests[0].model || '对话') : group.label}</strong><span>{new Date(group.requests[0].timestamp).toLocaleString()} · {group.requests.length} 条请求{group.key.startsWith('session:') && ` · ${group.label.slice(0, 8)}…`}</span></span><span className={styles.chevron} aria-hidden="true">⌄</span></summary>
    {open && <div className={styles.sessionIdentity}>Session <code>{group.label}</code></div>}
    {open && <>{group.requests.slice(0, limit).map(event => <RequestRow key={event.id ?? event.request_id} event={event} onOpen={onOpen} cache={cache} conversation />)}
      {limit < group.requests.length && <button className={styles.more} onClick={() => setLimit(n => n + 20)}>显示更多请求</button>}</>}
  </details>
}
export function RequestBrowser({ events, loading, totalCount, hasMore, loadingMore, onLoadMore, onOpen }: {
  events: UsageEvent[]; loading: boolean; totalCount: number; hasMore: boolean; loadingMore: boolean; autoLoadMore: boolean; onLoadMore?: () => void; onOpen?: (event: UsageEvent) => void
}) {
  const [mode, setMode] = useState<'time' | 'session'>(() => {
    try { return sessionStorage.getItem('keeper-prompt-browser-mode') === 'time' ? 'time' : 'session' } catch { return 'session' }
  })
  const changeMode = (value: 'time' | 'session') => {
    setMode(value)
    try { sessionStorage.setItem('keeper-prompt-browser-mode', value) } catch { /* Storage can be unavailable in embedded contexts. */ }
    setLimit(20)
  }
  const [limit, setLimit] = useState(20)
  const [cache] = useState(() => new Map<string, UsageEventConversation>())
  const sorted = useMemo(() => [...events].sort(compareRequests), [events])
  const groups = useMemo(() => groupRequests(events), [events])
  return <div className={styles.browser}>
    <div className={styles.toolbar}>
      <div className={styles.segmented} aria-label="请求查看方式">
      <button aria-pressed={mode === 'time'} onClick={() => changeMode('time')}>全部请求</button>
      <button aria-pressed={mode === 'session'} onClick={() => changeMode('session')}>会话 Session</button>
      </div>
      <span className={styles.note}>{mode === 'session' ? '最近优先 · 展开阅读对话' : '最近优先 · 预览前 50 字'}</span>
    </div>
    {loading && events.length > 0 && <p className={styles.note} role="status">正在获取新增请求，当前阅读内容保持显示…</p>}
    {loading && events.length === 0 ? <p role="status">正在加载请求…</p> : events.length === 0 ? <p>当前筛选范围内没有请求。</p> : mode === 'session' ? <>
      <p className={styles.note}>已加载 {events.length} / {totalCount} 条请求 · 当前已加载记录含 {groups.length} 个分组{hasMore ? '；每个 Session 可能还有更早请求，按需加载更多。' : ''}</p>
      {groups.slice(0, limit).map(group => <SessionGroup key={group.key} group={group} onOpen={onOpen} cache={cache} />)}
      {limit < groups.length && <button className={styles.more} onClick={() => setLimit(n => n + 20)}>显示更多 Session</button>}
      {hasMore && <button className={styles.more} disabled={loading || loadingMore} onClick={onLoadMore}>{loadingMore ? '加载中…' : '加载更早请求'}</button>}
    </> : <>
      {sorted.slice(0, limit).map(event => <RequestRow key={event.id ?? event.request_id} event={event} onOpen={onOpen} cache={cache} />)}
      {limit < sorted.length ? <button className={styles.more} onClick={() => setLimit(n => n + 20)}>显示更多请求</button> : hasMore && <button className={styles.more} disabled={loadingMore} onClick={() => { setLimit(n => n + 20); onLoadMore?.() }}>{loadingMore ? '加载中…' : '加载更多请求'}</button>}
      <p className={styles.note}>已加载 {events.length} / {totalCount} 条请求</p>
    </>}
  </div>
}
