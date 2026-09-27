import { describe, expect, it } from 'vitest'
import { inspectPrompt } from '../promptInspector'

const inspect = (body: string) => inspectPrompt([{ title: 'REQUEST BODY', content: body }])
describe('incoming Prompt inspection', () => {
  it('preserves full original parameters and structured messages/tools without mixing upstream data', () => {
    const body = JSON.stringify({model:'test',messages:[{role:'system',content:'policy'},{role:'user',content:[{type:'text',text:'你好'},{type:'image_url',image_url:{url:'data:image/png;base64,test'}}]},{role:'tool',content:'result',tool_call_id:'42'}],tools:[{type:'function',function:{name:'search'}}],temperature:0.2})
    const result = inspectPrompt([{title:'API REQUEST 1',content:'transformed'}, {title:'REQUEST BODY',content:body}])!
    expect(result.raw).toBe(body)
    expect(JSON.parse(result.prompt!)).toEqual({messages:JSON.parse(body).messages,tools:JSON.parse(body).tools})
  })
  it.each([
    {instructions:'system',input:[{role:'user',content:'hello'}],previous_response_id:'resp_1'},
    {system:[{type:'text',text:'policy'}],messages:[{role:'user',content:'hello'}]},
    {systemInstruction:{parts:[{text:'policy'}]},contents:[{parts:[{text:'hello'}]}]},
    {prompt:'completion input'},
  ])('supports common API prompt formats', params => {
    expect(JSON.parse(inspect(JSON.stringify(params))!.prompt!)).toEqual(params)
  })
  it('retains malformed and non-JSON inputs verbatim', () => {
    expect(inspect('{broken')).toEqual({raw:'{broken',prompt:null})
    expect(inspect('[]')).toEqual({raw:'[]',prompt:null})
    expect(inspect('{"model":"test"}')?.prompt).toBeNull()
    expect(inspectPrompt([{title:'API REQUEST 1',content:'{}'}])).toBeNull()
  })
  it('keeps large payloads and empty prompt values without truncation', () => {
    const input = 'x'.repeat(1024*1024)
    expect(JSON.parse(inspect(JSON.stringify({input}))!.prompt!).input).toHaveLength(input.length)
    expect(JSON.parse(inspect('{"prompt":""}')!.prompt!)).toEqual({prompt:''})
  })
})
