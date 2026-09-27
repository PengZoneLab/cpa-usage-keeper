// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { PromptReader } from '../PromptReader'
let root: Root
let box: HTMLDivElement
const copy = vi.fn(async (_text: string) => {})
const long = vi.fn((title: string, text: string) => <div data-long={title}>{text.length}</div>)
beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await i18n.changeLanguage('en'); box=document.createElement('div'); document.body.append(box)
  root=createRoot(box); copy.mockClear(); long.mockClear()
})
afterEach(async()=>{await act(async()=>root.unmount());box.remove()})
async function mount(body:string){await act(async()=>root.render(<PromptReader response={{event_id:'1',request_id:'req',available:true,sections:[{title:'REQUEST BODY',content:body}]}} copyContent={copy} renderLongContent={long}><div>original logs</div></PromptReader>))}
async function click(text:string){const b=[...box.querySelectorAll('button')].find(x=>x.textContent===text);expect(b).toBeTruthy();await act(async()=>b!.click())}
describe('PromptReader user paths',()=>{
 it('switches views and preserves null, tool metadata, empty arrays and original copy',async()=>{
  const body='{"model":"test","stream":true,"messages":[{"role":"assistant","content":null,"tool_calls":[{"id":"call-1"}]}],"input":[],"temperature":0.4}'
  await mount(body);expect(box.textContent).toContain('SSE / Stream');expect(box.textContent).toContain('null');expect(box.textContent).toContain('call-1');expect(box.textContent).toContain('[]')
  await click('Copy content');expect(JSON.parse(copy.mock.calls[0][0]).messages[0].content).toBeNull()
  await click('Parameters');expect(box.querySelector('pre')?.textContent).toBe(body)
  await click('Copy content');expect(copy.mock.calls.at(-1)?.[0]).toBe(body)
  await click('Raw logs');expect(box.textContent).toContain('original logs');expect(box.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Raw logs')
 })
 it('sends long prompt and parameters to windowed renderer, retaining full copy',async()=>{
  const value='长'.repeat(140000);const body=JSON.stringify({input:value});await mount(body)
  expect(box.querySelectorAll('article')).toHaveLength(0);expect(JSON.parse(long.mock.calls.at(-1)![1]).input).toBe(value)
  await click('Parameters');expect(long.mock.calls.at(-1)![1]).toBe(body)
  await click('Copy content');expect(copy.mock.calls.at(-1)?.[0]).toBe(body)
 })
 it('keeps malformed input and reports missing prompt',async()=>{
  await mount('{broken');expect(box.textContent).toContain('original logs')
  await click('Parameters');expect(box.querySelector('pre')?.textContent).toBe('{broken')
  await click('Conversation');expect(box.textContent).toContain('No conversation fields found')
  expect([...box.querySelectorAll('button')].find(x=>x.textContent==='Copy content')?.disabled).toBe(true)
 })
})
