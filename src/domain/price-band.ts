// src/domain/price-band.ts
// Pure function. No IO. now is always passed in.
//
// priceBand returns the nearest-rank 25th and 75th percentile prices from
// completed exchanges in the given circle for the given item over the last 24h.
// Returns null when fewer than 3 trades meet the criteria.

import type { MarketState, Item } from './types.js'

export interface PriceBand {
  lowKobo: number
  highKobo: number
  trades: number
}

const WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
const MIN_TRADES = 3

/**
 * Nearest-rank percentile (1-indexed, no interpolation).
 * rank(p, n) = ceil(p / 100 * n), clamped to [1, n].
 * Returns the value at that rank from a sorted-ascending array.
 */
function nearestRank(sorted: number[], percentile: number): number {
  const n = sorted.length
  const rank = Math.ceil((percentile / 100) * n)
  const idx = Math.max(0, Math.min(rank - 1, n - 1))
  return sorted[idx]
}

export function priceBand(
  state: MarketState,
  item: Item,
  circleId: string,
  now: Date,
): PriceBand | null {
  const windowStart = new Date(now.getTime() - WINDOW_MS)

  const prices = state.priceHistory
    .filter(r =>
      r.item.name === item.name &&
      r.item.grade === item.grade &&
      r.item.unit === item.unit &&
      r.circleId === circleId &&
      r.collectedAt >= windowStart &&
      r.collectedAt <= now,
    )
    .map(r => r.priceKobo)

  if (prices.length < MIN_TRADES) return null

  const sorted = [...prices].sort((a, b) => a - b)
  const lowKobo = nearestRank(sorted, 25)
  const highKobo = nearestRank(sorted, 75)

  return { lowKobo, highKobo, trades: sorted.length }
}

/** Format a band result as the SMS hint line. Amounts are credits (kobo / 100). */
export function formatBandLine(band: PriceBand): string {
  const low = (band.lowKobo / 100).toLocaleString('en', { maximumFractionDigits: 0 })
  const high = (band.highKobo / 100).toLocaleString('en', { maximumFractionDigits: 0 })
  return `Usual today: ${low}-${high} (${band.trades} trades)`
}
