// src/domain/events.ts
import type {
  TraderId, RequestCode, CircleId, OfferId, CrateId, HoldId,
  DispatchId, Item, WorkspaceId,
} from './types.js'

export type DomainEvent =
  | WorkspaceCreatedEvent
  | CircleCreatedEvent
  | CircleLinkedEvent
  | TraderEnrolledEvent
  | TraderStoppedEvent
  | (Omit<TraderStoppedEvent, 'type'> & { type: 'trader_started' })
  | RequestCreatedEvent
  | SellerInvitedEvent
  | OfferMadeEvent
  | OfferRevisedEvent
  | OfferReleasedEvent
  | RequestAcceptedEvent
  | HoldCreatedEvent
  | HoldExpiredEvent
  | HoldReleasedEvent
  | RequestCollectedEvent
  | RequestWidenedEvent
  | RequestRoutedEvent
  | RequestCancelledEvent
  | RequestExpiredEvent
  | FallbackSentEvent
  | DemoTradeSeededEvent
  | ShortageAlertedEvent
  | PickupCodeRejectedEvent

export interface PickupCodeRejectedEvent {
  type: 'pickup_code_rejected'
  workspaceId: WorkspaceId
  holdId: HoldId
  requestCode: RequestCode
  by: TraderId
  at: Date
}

export interface DemoTradeSeededEvent {
  type: 'demo_trade_seeded'
  workspaceId: WorkspaceId
  circleId: CircleId
  item: Item
  priceKobo: number
  at: Date
}

export interface ShortageAlertedEvent {
  type: 'shortage_alerted'
  workspaceId: WorkspaceId
  circleId: CircleId
  item: Item
  asked: number
  filled: number
  windowKey: string
  at: Date
}

export interface WorkspaceCreatedEvent {
  type: 'workspace_created'
  workspaceId: WorkspaceId
  kind: 'demo' | 'live'
  at: Date
}

export interface CircleCreatedEvent {
  type: 'circle_created'
  workspaceId: WorkspaceId
  circleId: CircleId
  name: string
  at: Date
}

export interface CircleLinkedEvent {
  type: 'circle_linked'
  workspaceId: WorkspaceId
  circleId: CircleId
  neighbourId: CircleId
  at: Date
}

export interface TraderEnrolledEvent {
  type: 'trader_enrolled'
  workspaceId: WorkspaceId
  traderId: TraderId
  alias: string
  circleId: CircleId
  role: 'trader' | 'coordinator'
  at: Date
}

export interface TraderStoppedEvent {
  type: 'trader_stopped'
  workspaceId: WorkspaceId
  traderId: TraderId
  at: Date
}

export interface RequestCreatedEvent {
  type: 'request_created'
  workspaceId: WorkspaceId
  requestCode: RequestCode
  requesterId: TraderId
  item: Item
  quantity: number
  cutoffAt: Date
  at: Date
}

export interface SellerInvitedEvent {
  type: 'seller_invited'
  workspaceId: WorkspaceId
  requestCode: RequestCode
  sellerId: TraderId
  at: Date
}

export interface OfferMadeEvent {
  type: 'offer_made'
  workspaceId: WorkspaceId
  offerId: OfferId
  requestCode: RequestCode
  crateId: CrateId
  sellerId: TraderId
  priceKobo: number
  pickupArea: string
  replyRef: string
  revision: number
  at: Date
}

export interface OfferRevisedEvent {
  type: 'offer_revised'
  workspaceId: WorkspaceId
  offerId: OfferId
  requestCode: RequestCode
  priceKobo: number
  pickupArea: string
  revision: number
  at: Date
}

export interface OfferReleasedEvent {
  type: 'offer_released'
  workspaceId: WorkspaceId
  offerId: OfferId
  requestCode: RequestCode
  crateId: CrateId
  reason: 'accepted_other' | 'crate_taken' | 'cancelled' | 'expired'
  at: Date
}

export interface RequestAcceptedEvent {
  type: 'request_accepted'
  workspaceId: WorkspaceId
  requestCode: RequestCode
  offerId: OfferId
  crateId: CrateId
  at: Date
}

export interface HoldCreatedEvent {
  type: 'hold_created'
  pickupCode?: string
  workspaceId: WorkspaceId
  holdId: HoldId
  requestCode: RequestCode
  offerId: OfferId
  crateId: CrateId
  heldUntil: Date
  at: Date
}

export interface HoldExpiredEvent {
  type: 'hold_expired'
  workspaceId: WorkspaceId
  holdId: HoldId
  requestCode: RequestCode
  crateId: CrateId
  at: Date
}

export interface HoldReleasedEvent {
  type: 'hold_released'
  workspaceId: WorkspaceId
  holdId: HoldId
  requestCode: RequestCode
  crateId: CrateId
  reason: 'cancelled' | 'requester_stopped'
  at: Date
}

export interface RequestCollectedEvent {
  type: 'request_collected'
  workspaceId: WorkspaceId
  requestCode: RequestCode
  holdId: HoldId
  crateId: CrateId
  at: Date
}

export interface RequestWidenedEvent {
  type: 'request_widened'
  workspaceId: WorkspaceId
  requestCode: RequestCode
  at: Date
}

export interface RequestRoutedEvent {
  type: 'request_routed'
  workspaceId: WorkspaceId
  requestCode: RequestCode
  dispatchId: DispatchId
  circleId: CircleId
  routedById: TraderId
  invitedSellerIds: TraderId[]
  at: Date
}

export interface RequestCancelledEvent {
  type: 'request_cancelled'
  workspaceId: WorkspaceId
  requestCode: RequestCode
  at: Date
}

export interface RequestExpiredEvent {
  type: 'request_expired'
  workspaceId: WorkspaceId
  requestCode: RequestCode
  reason: 'cutoff_passed' | 'hold_expired'
  at: Date
}

export interface FallbackSentEvent {
  type: 'fallback_sent'
  workspaceId: WorkspaceId
  requestCode: RequestCode
  at: Date
}
