// src/domain/evolve.ts
// Pure function: given a state and an event, return the next state.
// No IO. No Date.now(). The state is rebuilt by replaying events from empty.

import { emptyMarketState } from './types.js'
import type {
  MarketState, TraderRecord, CircleRecord, RequestRecord,
  OfferRecord, CrateRecord, HoldRecord, DispatchRecord,
} from './types.js'
import type { DomainEvent } from './events.js'
import { shortageAlertKey } from './shortage.js'

export function evolve(state: MarketState, ev: DomainEvent): MarketState {
  switch (ev.type) {
    case 'demo_trade_seeded':
      return { ...state, priceHistory: [...state.priceHistory, {
        item: ev.item, circleId: ev.circleId, priceKobo: ev.priceKobo, collectedAt: ev.at,
      }] }
    case 'shortage_alerted': {
      const shortageAlerts = new Map(state.shortageAlerts)
      shortageAlerts.set(shortageAlertKey(ev.circleId, ev.item), ev.at)
      return { ...state, shortageAlerts }
    }
    case 'pickup_code_rejected': {
      const holds = new Map(state.holds)
      const h = holds.get(ev.holdId)
      if (h) holds.set(ev.holdId, { ...h, wrongCodeAttempts: (h.wrongCodeAttempts ?? 0) + 1 })
      return { ...state, holds }
    }
    case 'workspace_created':
      return { ...emptyMarketState(ev.workspaceId) }

    case 'circle_created': {
      const c: CircleRecord = { id: ev.circleId, name: ev.name, neighbourIds: [] }
      const circles = new Map(state.circles)
      circles.set(ev.circleId, c)
      return { ...state, circles }
    }

    case 'circle_linked': {
      const circles = new Map(state.circles)
      const a = circles.get(ev.circleId)
      const b = circles.get(ev.neighbourId)
      if (a && !a.neighbourIds.includes(ev.neighbourId)) {
        circles.set(ev.circleId, { ...a, neighbourIds: [...a.neighbourIds, ev.neighbourId] })
      }
      if (b && !b.neighbourIds.includes(ev.circleId)) {
        circles.set(ev.neighbourId, { ...b, neighbourIds: [...b.neighbourIds, ev.circleId] })
      }
      return { ...state, circles }
    }

    case 'trader_enrolled': {
      const t: TraderRecord = {
        id: ev.traderId,
        alias: ev.alias,
        circleId: ev.circleId,
        role: ev.role,
        stoppedAt: null,
      }
      const traders = new Map(state.traders)
      traders.set(ev.traderId, t)
      return { ...state, traders }
    }

    case 'trader_started':
    case 'trader_stopped': {
      const traders = new Map(state.traders)
      const t = traders.get(ev.traderId)
      if (t) traders.set(ev.traderId, { ...t, stoppedAt: ev.type === 'trader_stopped' ? ev.at : null })
      return { ...state, traders }
    }

    case 'request_created': {
      const req: RequestRecord = {
        code: ev.requestCode,
        createdAt: ev.at,
        requesterId: ev.requesterId,
        item: ev.item,
        quantity: ev.quantity,
        cutoffAt: ev.cutoffAt,
        state: 'open_local',
        widenedAt: null,
        invitedSellerIds: [],
        fallbackSentAt: null,
      }
      const requests = new Map(state.requests)
      requests.set(ev.requestCode, req)
      return { ...state, requests, nextRequestNumber: state.nextRequestNumber + 1 }
    }

    case 'seller_invited': {
      const requests = new Map(state.requests)
      const req = requests.get(ev.requestCode)
      if (req && !req.invitedSellerIds.includes(ev.sellerId)) {
        requests.set(ev.requestCode, {
          ...req,
          invitedSellerIds: [...req.invitedSellerIds, ev.sellerId],
        })
      }
      return { ...state, requests }
    }

    case 'offer_made': {
      const offer: OfferRecord = {
        id: ev.offerId,
        requestCode: ev.requestCode,
        crateId: ev.crateId,
        sellerId: ev.sellerId,
        priceKobo: ev.priceKobo,
        pickupArea: ev.pickupArea,
        replyRef: ev.replyRef,
        revision: ev.revision,
        state: 'proposed',
      }
      const offers = new Map(state.offers)
      offers.set(ev.offerId, offer)

      // Create crate if new
      const crates = new Map(state.crates)
      if (!crates.has(ev.crateId)) {
        const req = state.requests.get(ev.requestCode)
        const crate: CrateRecord = {
          id: ev.crateId,
          sellerId: ev.sellerId,
          item: req ? req.item : { name: '', grade: '', unit: '' },
          state: 'available',
        }
        crates.set(ev.crateId, crate)
      }
      return { ...state, offers, crates }
    }

    case 'offer_revised': {
      const offers = new Map(state.offers)
      const o = offers.get(ev.offerId)
      if (o) {
        offers.set(ev.offerId, {
          ...o,
          priceKobo: ev.priceKobo,
          pickupArea: ev.pickupArea,
          revision: ev.revision,
        })
      }
      return { ...state, offers }
    }

    case 'offer_released': {
      const offers = new Map(state.offers)
      const o = offers.get(ev.offerId)
      if (o) offers.set(ev.offerId, { ...o, state: 'released' })
      const crates = new Map(state.crates)
      const crate = crates.get(ev.crateId)
      if (crate && crate.state === 'held') {
        // Only free crate if released due to something other than it being taken
        // (taken means another hold took it and that hold manages crate state)
      }
      return { ...state, offers }
    }

    case 'request_accepted': {
      const requests = new Map(state.requests)
      const req = requests.get(ev.requestCode)
      if (req) requests.set(ev.requestCode, { ...req, state: 'held' })
      const offers = new Map(state.offers)
      const o = offers.get(ev.offerId)
      if (o) offers.set(ev.offerId, { ...o, state: 'accepted' })
      const crates = new Map(state.crates)
      const crate = crates.get(ev.crateId)
      if (crate) crates.set(ev.crateId, { ...crate, state: 'held' })
      return { ...state, requests, offers, crates }
    }

    case 'hold_created': {
      const hold: HoldRecord = {
        id: ev.holdId,
        requestCode: ev.requestCode,
        offerId: ev.offerId,
        crateId: ev.crateId,
        heldUntil: ev.heldUntil,
        pickupCode: ev.pickupCode,
        state: 'live',
      }
      const holds = new Map(state.holds)
      holds.set(ev.holdId, hold)
      return { ...state, holds }
    }

    case 'hold_expired': {
      const holds = new Map(state.holds)
      const h = holds.get(ev.holdId)
      if (h) holds.set(ev.holdId, { ...h, state: 'expired' })
      const crates = new Map(state.crates)
      const crate = crates.get(ev.crateId)
      if (crate) crates.set(ev.crateId, { ...crate, state: 'available' })
      return { ...state, holds, crates }
    }

    case 'hold_released': {
      const holds = new Map(state.holds)
      const h = holds.get(ev.holdId)
      if (h) holds.set(ev.holdId, { ...h, state: 'released' })
      const crates = new Map(state.crates)
      const crate = crates.get(h?.crateId ?? '')
      if (crate) crates.set(crate.id, { ...crate, state: 'available' })
      return { ...state, holds, crates }
    }

    case 'request_collected': {
      const requests = new Map(state.requests)
      const req = requests.get(ev.requestCode)
      if (req) requests.set(ev.requestCode, { ...req, state: 'collected' })
      const holds = new Map(state.holds)
      const h = holds.get(ev.holdId)
      if (h) holds.set(ev.holdId, { ...h, state: 'collected' })
      const crates = new Map(state.crates)
      const crate = crates.get(ev.crateId)
      if (crate) crates.set(ev.crateId, { ...crate, state: 'collected' })

      // Task 18: append a PriceRecord for fair-price band calculation.
      // Derive item from the request, circleId from the requester's trader record,
      // and priceKobo from the accepted offer linked through the live hold.
      // Using pre-mutation state to look up offer and trader (hold state not yet updated above).
      const priceHistory = state.priceHistory
      let newPriceHistory = priceHistory
      if (req && h) {
        const offer = state.offers.get(h.offerId)
        const requester = state.traders.get(req.requesterId)
        if (offer && requester) {
          newPriceHistory = [
            ...priceHistory,
            {
              item: req.item,
              circleId: requester.circleId,
              priceKobo: offer.priceKobo,
              collectedAt: ev.at,
            },
          ]
        }
      }
      return { ...state, requests, holds, crates, priceHistory: newPriceHistory }
    }

    case 'request_widened': {
      const requests = new Map(state.requests)
      const req = requests.get(ev.requestCode)
      if (req) requests.set(ev.requestCode, { ...req, state: 'widened', widenedAt: ev.at })
      return { ...state, requests }
    }

    case 'request_routed': {
      const dispatch: DispatchRecord = {
        id: ev.dispatchId,
        requestCode: ev.requestCode,
        circleId: ev.circleId,
        routedById: ev.routedById,
        invitedSellerIds: ev.invitedSellerIds,
        createdAt: ev.at,
      }
      const dispatches = new Map(state.dispatches)
      dispatches.set(ev.requestCode, dispatch)

      // Track invited sellers on the request too
      const requests = new Map(state.requests)
      const req = requests.get(ev.requestCode)
      if (req) {
        const newIds = ev.invitedSellerIds.filter(id => !req.invitedSellerIds.includes(id))
        requests.set(ev.requestCode, {
          ...req,
          invitedSellerIds: [...req.invitedSellerIds, ...newIds],
        })
      }
      return { ...state, dispatches, requests }
    }

    case 'request_cancelled': {
      const requests = new Map(state.requests)
      const req = requests.get(ev.requestCode)
      if (req) requests.set(ev.requestCode, { ...req, state: 'cancelled' })
      return { ...state, requests }
    }

    case 'request_expired': {
      const requests = new Map(state.requests)
      const req = requests.get(ev.requestCode)
      if (req) requests.set(ev.requestCode, { ...req, state: 'expired' })
      return { ...state, requests }
    }

    case 'fallback_sent': {
      const requests = new Map(state.requests)
      const req = requests.get(ev.requestCode)
      if (req) requests.set(ev.requestCode, { ...req, fallbackSentAt: ev.at })
      return { ...state, requests }
    }

    default: {
      const _exhaustive: never = ev
      return state
    }
  }
}

export function replayEvents(events: DomainEvent[], workspaceId: string): MarketState {
  return events.reduce(evolve, emptyMarketState(workspaceId))
}
