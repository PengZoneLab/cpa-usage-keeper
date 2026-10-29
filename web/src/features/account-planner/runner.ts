import type { PlannerInput, PlannerResult } from './types'
export function runPlanner(input: PlannerInput): { promise: Promise<PlannerResult>; cancel: () => void } {
  const worker = new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' })
  let rejectPromise: (error: Error) => void = () => {}
  const promise = new Promise<PlannerResult>((resolve, reject) => {
    rejectPromise = reject
    worker.onmessage = event => { worker.terminate(); resolve(event.data as PlannerResult) }
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || '求解器加载失败')) }
    worker.postMessage(input)
  })
  return { promise, cancel: () => { worker.terminate(); rejectPromise(new DOMException('已取消计算', 'AbortError')) } }
}
