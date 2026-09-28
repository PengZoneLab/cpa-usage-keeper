import type { UsageEvent } from '@/lib/types'

// Fetch through the last timestamp of the existing head. A complete overlap page
// makes equal-timestamp requests safe even when a refresh has more than 50 new rows.
export function reachedRefreshBoundary(incoming: readonly UsageEvent[], previous: readonly UsageEvent[]) {
  const head = previous[0]
  if (!head?.id) return true
  return incoming.some(event => event.id === head.id)
    && incoming.some(event => Date.parse(event.timestamp) < Date.parse(head.timestamp))
}
