import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsageEventRequestLogResponse } from '@/lib/types'
import { inspectPrompt } from './promptInspector'
import s from './PromptReader.module.scss'

const display = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''

export function PromptReader({ response, children, copyContent, renderLongContent }: { response: UsageEventRequestLogResponse; children: ReactNode; copyContent: (text: string) => Promise<void>; renderLongContent: (title: string, text: string) => ReactNode }) {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const [view, setView] = useState(() => inspectPrompt(response.sections)?.prompt ? 'prompt' : 'logs')
  const [copied, setCopied] = useState('')
  const inspection = useMemo(() => inspectPrompt(response.sections), [response])
  const params = useMemo(() => {
    try { return JSON.parse(inspection?.raw ?? '{}') as Record<string, unknown> } catch { return {} }
  }, [inspection])
  const prompt = useMemo(() => {
    try { return JSON.parse(inspection?.prompt ?? '{}') as Record<string, unknown> } catch { return {} }
  }, [inspection])
  const largePrompt = (inspection?.prompt?.length ?? 0) > 131072
  const bodyBytes = useMemo(() => new TextEncoder().encode(inspection?.raw ?? '').length, [inspection])
  const entries = useMemo(() => largePrompt ? [] : Object.entries(prompt).flatMap(([key, value]) => {
    if ((key === 'messages' || key === 'input' || key === 'contents') && Array.isArray(value) && value.length > 0) {
      return value.map((message: unknown) => {
        if (message && typeof message === 'object' && 'role' in message) {
          const { role, content, ...rest } = message as Record<string, unknown>
          return { role: String(role), text: display(content !== undefined ? content : rest), extra: content !== undefined && Object.keys(rest).length ? display(rest) : '' }
        }
        return { role: key, text: display(message), extra: '' }
      })
    }
    return [{ role: key, text: display(value), extra: '' }]
  }), [prompt, largePrompt])
  const copy = async () => {
    try {
      await copyContent(view === 'params' ? inspection?.raw ?? '' : inspection?.prompt ?? '')
      setCopied(zh ? '已复制' : 'Copied')
    } catch { setCopied(zh ? '复制失败，请重试' : 'Copy failed. Retry.') }
  }
  const tabs = [{id:'prompt',label:zh?'对话内容':'Conversation'}, {id:'params',label:zh?'完整入参':'Parameters'}, {id:'logs',label:zh?'原始日志':'Raw logs'}]
  return <div className={s.reader}>
    <aside className={s.summary}>
      <div className={s.brand}>Prompt<span> / </span>Inspector</div>
      <h3>{typeof params?.model === 'string' ? params.model : zh ? '请求详情' : 'Request details'}</h3>
      <dl>
        <dt>{zh ? '请求 ID' : 'Request ID'}</dt><dd>{response.request_id || '—'}</dd>
        <dt>{zh ? '传输方式' : 'Transport'}</dt><dd>{params?.stream === true ? 'SSE / Stream' : params?.stream === false ? 'JSON' : '—'}</dd>
        <dt>{zh ? '请求正文' : 'Request body'}</dt><dd>{inspection ? `${bodyBytes.toLocaleString()} bytes` : '—'}</dd>
      </dl>
      <p>{zh ? '保留这一次请求传入的内容。未记录的历史与服务端上下文不会补全。' : 'The content sent in this request. Unrecorded history and server-held context are not reconstructed.'}</p>
    </aside>
    <div className={s.workspace}>
      <nav className={s.tabs} aria-label={zh ? '请求内容视图' : 'Request content views'}>
        {tabs.map(tab => <button key={tab.id} type="button" aria-pressed={view===tab.id} onClick={()=>{setView(tab.id);setCopied('')}}>{tab.label}</button>)}
      </nav>
      <div className={s.content}>
        {view !== 'logs' && <div className={s.tools}>
          <span>{view==='prompt' ? (largePrompt ? (zh ? '长内容 · 分段阅读' : 'Long content · Windowed view') : (zh ? `${entries.length} 个内容区块` : `${entries.length} content blocks`)) : (zh ? '原始正文 · 未改写' : 'Original body · Unmodified')}</span>
          <button type="button" onClick={()=>void copy()} disabled={!inspection || (view==='prompt' && !inspection.prompt)}>{copied || (zh ? '复制内容' : 'Copy content')}</button>
          <span className={s.srOnly} role="status">{copied}</span>
        </div>}
        {view==='prompt' && (largePrompt ? renderLongContent('Prompt', inspection?.prompt ?? '') : entries.length ? <div className={s.messages}>{entries.map((entry,index)=><article key={index} className={s.message}>
          <div className={s.role} data-role={entry.role}>{entry.role}<span>{String(index+1).padStart(2,'0')}</span></div>
          <pre>{entry.text}</pre>{entry.extra && <pre className={s.extra}>{entry.extra}</pre>}
        </article>)}</div> : <p className={s.empty}>{zh ? '未识别到对话内容，可切换到完整入参或原始日志查看。' : 'No conversation fields found. Inspect parameters or raw logs.'}</p>)}
        {view==='params' && (bodyBytes > 131072 ? renderLongContent(zh ? '完整入参' : 'Parameters', inspection?.raw ?? '') : <pre className={s.raw}>{inspection?.raw || (zh ? '没有可用的请求正文，请查看原始日志。' : 'No request body available. Inspect raw logs.')}</pre>)}
        {view==='logs' && children}
      </div>
    </div>
  </div>
}
