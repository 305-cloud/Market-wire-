// src/domain/types.ts
// Core value types shared across the domain.

export type WorkspaceId = string
export type TraderId = string
export type RequestCode = string // e.g. "E7"
export type CircleId = string
export type OfferId = string
export type CrateId = string
export type HoldId = string
export type DispatchId = string

export interface Item {
  name: string
  grade: string
  unit: string // e.g. "crate30"
}

export type RequestState = 'open_local' | 'widened' | 'held' | 'collected' | 'cancelled' | 'expired'
export type OfferState = 'proposed' | 'accepted' | 'released' | 'expired' | 'withdrawn'
export type HoldState = 'live' | 'released' | 'collected' | 'expired'
export type CrateState = 'available' | 'held' | 'collected'

export interface TraderRecord {
  id: TraderId
  alias: string
  circleId: CircleId
  role: 'trader' | 'coordinator'
  stoppedAt: Date | null
}

export interface CircleRecord {
  id: CircleId
  name: string
  neighbourIds: CircleId[]
}

export interface RequestRecord {
  code: RequestCode
  createdAt?: Date
  requesterId: TraderId
  item: Item
  quantity: number
  cutoffAt: Date
  state: RequestState
  widenedAt: Date | null
  invitedSellerIds: TraderId[]
  fallbackSentAt: Date | null
}

export interface OfferRecord {
  id: OfferId
  requestCode: RequestCode
  crateId: CrateId
  sellerId: TraderId
  priceKobo: number
  pickupArea: string
  replyRef: string // "1", "2", etc. — per-request sequential
  revision: number // incremented on price change; a stale revision cannot accept
  state: OfferState
}

export interface CrateRecord {
  id: CrateId
  sellerId: TraderId
  item: Item
  state: CrateState
}

export interface HoldRecord {
  id: HoldId
  pickupCode?: string
  /** Wrong GIVEN codes so far; GIVEN locks at MAX_WRONG_PICKUP_CODES. */
  wrongCodeAttempts?: number
  requestCode: RequestCode
  offerId: OfferId
  crateId: CrateId
  heldUntil: Date
  state: HoldState
}

export interface DispatchRecord {
  id: DispatchId
  requestCode: RequestCode
  circleId: CircleId
  routedById: TraderId
  invitedSellerIds: TraderId[]
  createdAt: Date
}

/**
 * One completed trade recorded for the price-band feature (Task 18).
 * Appended to MarketState.priceHistory by evolve on every request_collected event.
 * Replay-compatible: derived entirely from already-evolved state plus the event's `at` field.
 */
export interface PriceRecord {
  item: Item
  circleId: CircleId   // circle of the original requester
  priceKobo: number    // from the accepted offer at collection time
  collectedAt: Date    // from the request_collected event's `at` field
}

export interface MarketState {
  workspaceId: WorkspaceId
  traders: Map<TraderId, TraderRecord>
  circles: Map<CircleId, CircleRecord>
  requests: Map<RequestCode, RequestRecord>
  offers: Map<OfferId, OfferRecord>
  crates: Map<CrateId, CrateRecord>
  holds: Map<HoldId, HoldRecord>
  dispatches: Map<RequestCode, DispatchRecord>
  nextRequestNumber: number
  /** Completed-trade price history used by priceBand() to compute fair-price hints. */
  priceHistory: PriceRecord[]
  /** Last shortage alert time per circle and item (key from shortageAlertKey). */
  shortageAlerts: Map<string, Date>
}

export function emptyMarketState(workspaceId: WorkspaceId): MarketState {
  return {
    workspaceId,
    traders: new Map(),
    circles: new Map(),
    requests: new Map(),
    offers: new Map(),
    crates: new Map(),
    holds: new Map(),
    dispatches: new Map(),
    nextRequestNumber: 1,
    priceHistory: [],
    shortageAlerts: new Map(),
  }
}

export type RejectReason =
  | 'wrong_pickup_code'
  | 'pickup_locked'
  | 'too_many_open'
  | 'no_sellers'
  | 'closed'
  | 'taken'
  | 'not_member'
  | 'not_requester'
  | 'not_coordinator'
  | 'not_widened'
  | 'stopped'
  | 'ambiguous'
  | 'past_cutoff'
  | 'unknown_request'
  | 'already_dispatched'
  | 'not_neighbour'
  | 'already_collected'
  | 'stale_revision'
