import type { MarketState, TraderId } from './types.js'

export function reliability(state: MarketState, traderId: TraderId) {
  let done = 0
  let missed = 0
  for (const hold of state.holds.values()) {
    const buyer = state.requests.get(hold.requestCode)?.requesterId
    const seller = state.offers.get(hold.offerId)?.sellerId
    if (hold.state === 'collected' && (traderId === buyer || traderId === seller)) done++
    if (hold.state === 'expired' && traderId === buyer) missed++
  }
  return done < 3 ? 'new' as const : { done, missed }
}
