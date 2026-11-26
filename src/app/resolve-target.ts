// src/app/resolve-target.ts
// Map buyer replies (offer references, request codes) to specific offers.
// Handles: bare "1", coded "1 E7", "WIDEN E7".
// Rejects stale bare 1 after a quote changes (uses revision check).

import type { MarketState, OfferRecord } from '../domain/types.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a buyer's reply to a specific offer (if one exists).
 * Returns null if the reply is ambiguous, refers to a closed request,
 * or the offer doesn't exist/stale.
 *
 * - bare "1" → latest offer on the requester's active request
 * - "1 E7" → offer with ref=1 on request E7
 * - Reject if offer was revised since the SMS was sent (stale)
 */
export interface ResolvedTarget {
  offer: OfferRecord
  requestCode: string
  stale: boolean
}

export function resolveTarget(
  state: MarketState,
  requestCode?: string,
  requesterId?: string,
  parsed?: { offerRef: number; code?: string },
): ResolvedTarget | null {
  // Determine which request to look at
  let req: { code: string; state: string } | null = null

  if (parsed?.code) {
    // Coded reference: "1 E7" or "WIDEN E7"
    const r = state.requests.get(parsed.code)
    if (!r) return null
    req = { code: r.code, state: r.state }
  } else if (requesterId) {
    // Bare reference: "1"
    // Find the requester's active request
    const activeRequests = [...state.requests.values()].filter(
      r => r.requesterId === requesterId &&
        (r.state === 'open_local' || r.state === 'widened'),
    )

    if (activeRequests.length === 0) {
      return null // No active request
    }

    if (activeRequests.length > 1) {
      return null // Ambiguous - need code
    }

    req = { code: activeRequests[0].code, state: activeRequests[0].state }
  }

  if (!req) return null

  // Reject closed requests
  if (req.state === 'held' || req.state === 'collected' || req.state === 'cancelled' || req.state === 'expired') {
    return null
  }

  // Find the target offer by replyRef
  const offer = [...state.offers.values()].find(
    o => o.requestCode === req!.code &&
      o.replyRef === String(parsed?.offerRef ?? 1) &&
      o.state === 'proposed',
  )

  if (!offer) return null

  // Check for stale revision: only compare against the SAME offer's own revision
  // A bare "1" is valid for an offer that was never revised (revision === 1)
  // If the offer has revision > 1, the buyer must use coded "1 E7" or "1 E7 V2"
  const bare1 = parsed?.offerRef === 1 && !parsed?.code
  const stale = bare1 && offer.revision > 1

  return {
    offer,
    requestCode: req!.code,
    stale,
  }
}

// ---------------------------------------------------------------------------
// Helper: get all pending offers for a request
// ---------------------------------------------------------------------------

export interface PendingOfferInfo {
  requestCode: string
  offers: { ref: string; sellerAlias: string; priceCents: number; pickupArea: string }[]
}

export function getPendingOffers(state: MarketState, requesterId: string): PendingOfferInfo | null {
  const activeRequests = [...state.requests.values()].filter(
    r => r.requesterId === requesterId && (r.state === 'open_local' || r.state === 'widened'),
  )

  if (activeRequests.length === 0) return null

  if (activeRequests.length > 1) {
    // Ambiguous - need code to disambiguate
    return null
  }

  const req = activeRequests[0]

  const offers = [...state.offers.values()]
    .filter(o => o.requestCode === req.code && o.state === 'proposed')
    .map(o => ({
      ref: o.replyRef,
      sellerAlias: state.traders.get(o.sellerId)?.alias ?? 'unknown',
      priceCents: o.priceCents,
      pickupArea: o.pickupArea,
    }))

  return {
    requestCode: req.code,
    offers,
  }
}