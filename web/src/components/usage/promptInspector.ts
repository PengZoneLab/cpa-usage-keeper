import type { UsageEventRequestLogSection } from '@/lib/types'

/** Inspect the incoming body only. Upstream transformed bodies remain in raw logs. */
export function inspectPrompt(sections: UsageEventRequestLogSection[]) {
  const body = sections.find(section => section.title.trim().toUpperCase() === 'REQUEST BODY')?.content
  if (body === undefined) return null
  try {
    const value: unknown = JSON.parse(body)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { raw: body, prompt: null }
    const params = value as Record<string, unknown>
    const prompt: Record<string, unknown> = {}
    // Preserve structured content, roles, tools, multimodal references and tool results.
    for (const key of ['system', 'instructions', 'messages', 'input', 'prompt', 'contents', 'systemInstruction', 'tools', 'tool_choice', 'functions', 'function_call', 'previous_response_id']) {
      if (Object.prototype.hasOwnProperty.call(params, key)) prompt[key] = params[key]
    }
    return { raw: body, prompt: Object.keys(prompt).length ? JSON.stringify(prompt, null, 2) : null }
  } catch {
    return { raw: body, prompt: null }
  }
}
