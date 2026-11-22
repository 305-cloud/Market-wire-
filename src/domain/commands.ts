// src/domain/commands.ts
import type { TraderId, RequestCode, CircleId, Item } from './types.js'

export type Command =
  | CreateRequestCommand
  | OfferCommand
  | AcceptCommand
  | CollectCommand
  | WidenCommand
  | RouteCommand
  | CancelCommand
  | StopCommand
  | { kind: 'start'; by: TraderId }
  | TickCommand

export interface CreateRequestCommand {
  kind: 'create_request'
  by: TraderId
  item: Item
  quantity: number
  cutoffAt: Date
}

export interface OfferCommand {
  kind: 'offer'
  by: TraderId
  requestCode: RequestCode
  priceKobo: number
  pickupArea: string
}

export interface AcceptCommand {
  kind: 'accept'
  pickupCode?: string
  by: TraderId
  requestCode: RequestCode
  offerRef: string    // the reply reference number, e.g. "1"
  offerRevision: number // must match offer's current revision; prevents stale-quote acceptance
}

export interface CollectCommand {
  kind: 'collect'
  pickupCode?: string
  by: TraderId
  requestCode: RequestCode
}

export interface WidenCommand {
  kind: 'widen'
  by: TraderId
  requestCode: RequestCode
}

export interface RouteCommand {
  kind: 'route'
  by: TraderId
  requestCode: RequestCode
  circleId: CircleId
}

export interface CancelCommand {
  kind: 'cancel'
  by: TraderId
  requestCode: RequestCode
}

export interface StopCommand {
  kind: 'stop'
  by: TraderId
}

export interface TickCommand {
  kind: 'tick'
}
