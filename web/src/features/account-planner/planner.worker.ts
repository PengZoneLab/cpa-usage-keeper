import loadHighs from 'highs'
import wasmURL from 'highs/runtime?url'
import { solveAccountPlan } from './solver'
import type { PlannerInput } from './types'
const engine = loadHighs({ locateFile: () => wasmURL })
self.onmessage = async (event: MessageEvent<PlannerInput>) => {
  try { self.postMessage(await solveAccountPlan(event.data, await engine)) }
  catch (error) { self.postMessage({ status: 'incomplete', message: String(error), ranking: [], stable: false, tied: false, computedAt: Date.now(), slots: 0, assumptions: [], elapsedMs: 0 }) }
}
