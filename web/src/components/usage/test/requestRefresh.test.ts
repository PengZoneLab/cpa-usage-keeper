import { describe, expect, it } from 'vitest'
import type { UsageEvent } from '@/lib/types'
import { reachedRefreshBoundary } from '../requestRefresh'
const event = (id: number, second: number) => ({ id: String(id), timestamp: new Date(second * 1000).toISOString() }) as UsageEvent

describe('incremental request refresh boundary', () => {
  it('continues across more than fifty new records until the previous head and timestamp overlap are reached', () => {
    const previous = [event(100, 100), event(99, 99)]
    const first = Array.from({ length: 50 }, (_, n) => event(200 - n, 200 - n))
    expect(reachedRefreshBoundary(first, previous)).toBe(false)
    const second = Array.from({ length: 50 }, (_, n) => event(150 - n, 150 - n))
    expect(reachedRefreshBoundary([...first, ...second], previous)).toBe(false)
    expect(reachedRefreshBoundary([...first, ...second, event(100, 100)], previous)).toBe(false)
    expect(reachedRefreshBoundary([...first, ...second, event(100, 100), event(99, 99)], previous)).toBe(true)
  })
  it('does not stop at a different old id or at equal timestamps', () => {
    const previous = [event(10, 10), event(9, 10), event(8, 9)]
    expect(reachedRefreshBoundary([event(9, 10), event(8, 9)], previous)).toBe(false)
    expect(reachedRefreshBoundary([event(11, 10), event(10, 10)], previous)).toBe(false)
    expect(reachedRefreshBoundary([event(11, 10), event(10, 10), event(9, 10), event(8, 9)], previous)).toBe(true)
  })
})
