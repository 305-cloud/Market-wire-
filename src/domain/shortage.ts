import type { Item, MarketState } from './types.js'

export const SHORTAGE_WINDOW_MINUTES = 120
export const SHORTAGE_MIN_ASKS = 5
export const SHORTAGE_FILL_RATIO = 0.5

export function shortageAlertKey(circleId: string, item: Item): string {
  return JSON.stringify([circleId, item.name, item.grade, item.unit])
}

export function shortageSummary(state: MarketState, now: Date, windowMinutes = SHORTAGE_WINDOW_MINUTES) {
  const start = now.getTime() - windowMinutes * 60_000
  const groups = new Map<string, { circleId: string; item: Item; asked: number; filled: number; open: number }>()
  for (const request of state.requests.values()) {
    if (!request.createdAt || request.createdAt.getTime() <= start || request.createdAt > now) continue
    // Claude fix (22 Nov): a request its own buyer cancelled is not an unmet ask (stops one trader faking a shortage).
    if (request.state === 'cancelled') continue
    const circleId = state.traders.get(request.requesterId)?.circleId
    if (!circleId) continue
    const key = JSON.stringify([circleId, request.item.name, request.item.grade, request.item.unit])
    const group = groups.get(key) ?? { circleId, item: request.item, asked: 0, filled: 0, open: 0 }
    group.asked++
    if (request.state === 'collected') group.filled++
    if (request.state === 'open_local' || request.state === 'widened' || request.state === 'held') group.open++
    groups.set(key, group)
  }
  return [...groups.values()].filter(group => group.asked >= SHORTAGE_MIN_ASKS &&
    group.filled / group.asked < SHORTAGE_FILL_RATIO)
}
