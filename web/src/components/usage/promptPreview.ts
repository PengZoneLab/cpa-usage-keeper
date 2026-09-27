import type { UsageEvent, UsageEventRequestLogResponse } from '@/lib/types'

export function compareRequests(a: UsageEvent, b: UsageEvent) {
  const time = Date.parse(b.timestamp) - Date.parse(a.timestamp)
  const fraction = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0')
  return time || fraction(b.timestamp).localeCompare(fraction(a.timestamp)) || String(b.id ?? '').localeCompare(String(a.id ?? ''), undefined, { numeric: true })
}
export function groupRequests(events: UsageEvent[]) {
  const groups = new Map<string, UsageEvent[]>()
  for (const event of [...events].sort(compareRequests)) {
    const key = event.session_metadata_available !== true ? 'unavailable' : event.session_id ? `session:${event.session_id}` : 'unassociated'
    const group = groups.get(key) ?? []
    group.push(event)
    groups.set(key, group)
  }
  return [...groups].map(([key, requests]) => ({ key, requests, label: key === 'unavailable' ? 'Session 信息不可用' : key === 'unassociated' ? '未关联 Session' : requests[0].session_id! }))
}
function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textContent).filter(Boolean).join(' ')
  if (!value || typeof value !== 'object') return ''
  const item = value as Record<string, unknown>
  return textContent(item.text ?? item.content ?? item.parts)
}
export function promptPreview(log: UsageEventRequestLogResponse): string {
  if (!log.available) return '请求日志不可用'
  if (log.too_large) return '日志较大，请打开详情下载原文'
  const body = log.sections.find(s => s.title.trim().toUpperCase() === 'REQUEST BODY')?.content
  if (!body) return '没有可预览的 Prompt'
  try {
    const value = JSON.parse(body) as Record<string, unknown>
    const messages = [value.messages, value.input, value.contents].find(Array.isArray) as Record<string, unknown>[] | undefined
    const user = messages?.filter(item => item && typeof item === 'object' && item.role === 'user').at(-1)
    const text = (textContent(user) || textContent(value.prompt) || textContent(value.input) || textContent(value.instructions) || textContent(value.system) || textContent(value.systemInstruction)).replace(/\s+/g, ' ').trim()
    const chars = Array.from(text)
    return chars.length ? chars.slice(0, 50).join('') + (chars.length > 50 ? '…' : '') : '没有文本 Prompt（查看详情）'
  } catch { return 'Prompt 解析失败，请查看详情' }
}
