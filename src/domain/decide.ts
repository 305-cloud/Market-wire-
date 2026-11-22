// src/domain/decide.ts
// Pure decision function. No IO. now is always passed in.
// Returns either a Decision (accepted) or Rejection (refused) with outbound intents.

import { randomUUID } from 'node:crypto'
import type { MarketState, TraderId, RejectReason } from './types.js'
import type { Command } from './commands.js'
import type { DomainEvent } from './events.js'
import type { TemplateId, TemplateVars } from '../messages/templates.js'
import { renderTemplate } from '../messages/templates.js'
import { priceBand, formatBandLine } from './price-band.js'
import { reliability } from './reliability.js'
import { shortageSummary, SHORTAGE_WINDOW_MINUTES } from './shortage.js'

export interface OutboundIntent {
  to: TraderId
  template: TemplateId
  vars: TemplateVars
  dedupeKey: string
  body: string
}

export interface Decision {
  ok: true
  events: DomainEvent[]
  outbound: OutboundIntent[]
}

export interface Rejection {
  ok: false
  reason: RejectReason
  outbound: OutboundIntent[]
}

function intent(
  to: TraderId,
  template: TemplateId,
  vars: TemplateVars,
  dedupeKey: string,
): OutboundIntent {
  return { to, template, vars, dedupeKey, body: renderTemplate(template, vars) }
}

function fmt(kobo: number): string {
  return (kobo / 100).toLocaleString('en', { maximumFractionDigits: 0 })
}

function recordLabel(state: MarketState, trader: TraderId, includeMissed = false): string {
  const record = reliability(state, trader)
  if (record === 'new') return record
  return `${record.done} done${includeMissed ? ', ' + record.missed + ' missed' : ''}`
}

function fmtTime(d: Date): string {
  return d.toISOString().slice(11, 16)  // HH:mm format
}

function minutesBefore(target: Date, minutes: number): Date {
  return new Date(target.getTime() - minutes * 60_000)
}

export function decide(state: MarketState, cmd: Command, now: Date): Decision | Rejection {
  switch (cmd.kind) {
    case 'create_request': return decideCreateRequest(state, cmd, now)
    case 'offer': return decideOffer(state, cmd, now)
    case 'accept': return decideAccept(state, cmd, now)
    case 'collect': return decideCollect(state, cmd, now)
    case 'widen': return decideWiden(state, cmd, now)
    case 'route': return decideRoute(state, cmd, now)
    case 'cancel': return decideCancel(state, cmd, now)
    case 'stop': return decideStop(state, cmd, now)
    case 'start':
      if (!state.traders.has(cmd.by)) return { ok: false, reason: 'not_member', outbound: [] }
      return { ok: true,
        events: [{ type: 'trader_started', workspaceId: state.workspaceId, traderId: cmd.by, at: now }],
        outbound: [intent(cmd.by, 'start_confirmed', {}, `start:${cmd.by}:${now.getTime()}`)] }
    case 'tick': return decideTick(state, now)
    default: {
      const _x: never = cmd
      return { ok: false, reason: 'unknown_request', outbound: [] }
    }
  }
}

function decideCreateRequest(
  state: MarketState,
  cmd: Extract<Command, { kind: 'create_request' }>,
  now: Date,
): Decision | Rejection {
  const requester = state.traders.get(cmd.by)
  if (!requester) return { ok: false, reason: 'not_member', outbound: [] }
  if (requester.stoppedAt) return { ok: false, reason: 'stopped', outbound: [] }
  if (cmd.cutoffAt <= now) return { ok: false, reason: 'past_cutoff', outbound: [] }

  const code = `E${state.nextRequestNumber}`
  const at = now

  const events: DomainEvent[] = [
    {
      type: 'request_created',
      workspaceId: state.workspaceId,
      requestCode: code,
      requesterId: cmd.by,
      item: cmd.item,
      quantity: cmd.quantity,
      cutoffAt: cmd.cutoffAt,
      at,
    },
  ]

  const outbound: OutboundIntent[] = [
    intent(cmd.by, 'request_confirmed', {
      code,
      qty: cmd.quantity,
      unit: cmd.item.unit,
      name: cmd.item.name,
      cutoff: fmtTime(cmd.cutoffAt),
    }, `request_confirmed:${code}`),
  ]

  // Invite all non-stopped traders in the requester's circle, excluding the requester
  const circle = state.circles.get(requester.circleId)
  const sellers = circle
    ? [...state.traders.values()].filter(t =>
        t.circleId === requester.circleId &&
        t.id !== cmd.by &&
        !t.stoppedAt &&
        t.role === 'trader',
      )
    : []

  for (const seller of sellers) {
    events.push({
      type: 'seller_invited',
      workspaceId: state.workspaceId,
      requestCode: code,
      sellerId: seller.id,
      at,
    })
    outbound.push(intent(seller.id, 'seller_invited', {
      code,
      qty: cmd.quantity,
      unit: cmd.item.unit,
      name: cmd.item.name,
      cutoff: fmtTime(cmd.cutoffAt),
    }, `seller_invited:${code}:${seller.id}`))
  }

  return { ok: true, events, outbound }
}

function decideOffer(
  state: MarketState,
  cmd: Extract<Command, { kind: 'offer' }>,
  now: Date,
): Decision | Rejection {
  const req = state.requests.get(cmd.requestCode)
  if (!req) return { ok: false, reason: 'unknown_request', outbound: [] }

  const isClosed = req.state === 'collected' || req.state === 'cancelled' || req.state === 'expired'
  if (isClosed) return { ok: false, reason: 'closed', outbound: [
    intent(cmd.by, 'request_closed', {}, `closed:${cmd.requestCode}:${cmd.by}:${now.getTime()}`),
  ] }

  if (req.state === 'held') return { ok: false, reason: 'taken', outbound: [
    intent(cmd.by, 'request_closed', {}, `taken:${cmd.requestCode}:${cmd.by}:${now.getTime()}`),
  ] }

  if (now >= req.cutoffAt) return { ok: false, reason: 'past_cutoff', outbound: [
    intent(cmd.by, 'request_closed', {}, `pastcutoff:${cmd.requestCode}:${cmd.by}:${now.getTime()}`),
  ] }

  const seller = state.traders.get(cmd.by)
  if (!seller) return { ok: false, reason: 'not_member', outbound: [] }
  if (seller.stoppedAt) return { ok: false, reason: 'stopped', outbound: [] }
  if (cmd.by === req.requesterId) return { ok: false, reason: 'not_member', outbound: [] }

  // Must be invited (either local or via dispatch)
  if (!req.invitedSellerIds.includes(cmd.by)) {
    return { ok: false, reason: 'not_member', outbound: [] }
  }

  // Check if seller already has a proposed offer on this request (revise it)
  const existingOffer = [...state.offers.values()].find(
    o => o.requestCode === cmd.requestCode && o.sellerId === cmd.by && o.state === 'proposed',
  )

  // BUG A fix: refuse a new offer when the seller's crate for this item is already held
  // by a different request. Minting a second crate ID for the same physical stock is forbidden.
  if (!existingOffer) {
    const heldCrate = [...state.crates.values()].find(
      c => c.sellerId === cmd.by &&
        c.item.name === req.item.name &&
        c.item.grade === req.item.grade &&
        c.state === 'held',
    )
    if (heldCrate) {
      return { ok: false, reason: 'taken', outbound: [
        intent(cmd.by, 'request_closed', {}, `held_crate:${cmd.requestCode}:${cmd.by}:${now.getTime()}`),
      ] }
    }
  }

  if (existingOffer) {
    // Revise the existing offer (new price/area, incremented revision)
    const newRevision = existingOffer.revision + 1
    const requester = state.traders.get(req.requesterId)!
    const band = priceBand(state, req.item, requester.circleId, now)
    const events: DomainEvent[] = [
      {
        type: 'offer_revised',
        workspaceId: state.workspaceId,
        offerId: existingOffer.id,
        requestCode: cmd.requestCode,
        priceKobo: cmd.priceKobo,
        pickupArea: cmd.pickupArea,
        revision: newRevision,
        at: now,
      },
    ]
    const outbound: OutboundIntent[] = [
      intent(req.requesterId, 'offer_received', {
        code: cmd.requestCode,
        sellerAlias: seller.alias,
        qty: req.quantity,
        unit: req.item.unit,
        priceDisplay: fmt(cmd.priceKobo),
        area: cmd.pickupArea,
        cutoff: fmtTime(req.cutoffAt),
        ref: `${existingOffer.replyRef} ${cmd.requestCode} v${newRevision}`,
        record: recordLabel(state, cmd.by),
        ...(band !== null ? { bandLine: formatBandLine(band) } : {}),
      }, `offer_received:${cmd.requestCode}:${existingOffer.id}:rev${newRevision}`),
    ]
    return { ok: true, events, outbound }
  }

  // New offer: assign next replyRef
  // Never reuse a ref from ANY historical offer on this request (Bug 5)
  const existingRefs = [...state.offers.values()]
    .filter(o => o.requestCode === cmd.requestCode)  // All offers ever, regardless of state
    .map(o => parseInt(o.replyRef, 10))
    .filter(n => !isNaN(n))
  const nextRef = String((existingRefs.length > 0 ? Math.max(...existingRefs) : 0) + 1)

  // Find or create a crate for this seller+item
  const existingCrate = [...state.crates.values()].find(
    c => c.sellerId === cmd.by &&
      c.item.name === req.item.name &&
      c.item.grade === req.item.grade &&
      c.state === 'available',
  )
  const crateId = existingCrate?.id ?? randomUUID()
  const offerId = randomUUID()

  const events: DomainEvent[] = [
    {
      type: 'offer_made',
      workspaceId: state.workspaceId,
      offerId,
      requestCode: cmd.requestCode,
      crateId,
      sellerId: cmd.by,
      priceKobo: cmd.priceKobo,
      pickupArea: cmd.pickupArea,
      replyRef: nextRef,
      revision: 1,
      at: now,
    },
  ]

  const requesterRecord = state.traders.get(req.requesterId)
  const band = requesterRecord
    ? priceBand(state, req.item, requesterRecord.circleId, now)
    : null

  const outbound: OutboundIntent[] = [
    intent(req.requesterId, 'offer_received', {
      code: cmd.requestCode,
      sellerAlias: seller.alias,
      qty: req.quantity,
      unit: req.item.unit,
      priceDisplay: fmt(cmd.priceKobo),
      area: cmd.pickupArea,
      cutoff: fmtTime(req.cutoffAt),
      ref: nextRef,
      record: recordLabel(state, cmd.by),
      ...(band !== null ? { bandLine: formatBandLine(band) } : {}),
    }, `offer_received:${cmd.requestCode}:${offerId}:rev1`),
  ]

  return { ok: true, events, outbound }
}

function decideAccept(
  state: MarketState,
  cmd: Extract<Command, { kind: 'accept' }>,
  now: Date,
): Decision | Rejection {
  const req = state.requests.get(cmd.requestCode)
  if (!req) return { ok: false, reason: 'unknown_request', outbound: [] }

  if (cmd.by !== req.requesterId) return { ok: false, reason: 'not_requester', outbound: [] }

  const isClosed = req.state === 'collected' || req.state === 'cancelled' || req.state === 'expired'
  if (isClosed) return { ok: false, reason: 'closed', outbound: [
    intent(cmd.by, 'request_closed', {}, `closed:${cmd.requestCode}:${cmd.by}:${now.getTime()}`),
  ] }

  if (now >= req.cutoffAt) return { ok: false, reason: 'past_cutoff', outbound: [
    intent(cmd.by, 'request_closed', {}, `pastcutoff:${cmd.requestCode}:${cmd.by}:${now.getTime()}`),
  ] }

  if (req.state === 'held') return { ok: false, reason: 'taken', outbound: [
    intent(cmd.by, 'request_closed', {}, `held:${cmd.requestCode}:${cmd.by}:${now.getTime()}`),
  ] }

  // Find the target offer by replyRef
  const targetOffer = [...state.offers.values()].find(
    o => o.requestCode === cmd.requestCode &&
      o.replyRef === cmd.offerRef &&
      o.state === 'proposed',
  )

  if (!targetOffer) return { ok: false, reason: 'unknown_request', outbound: [] }

  // Stress review: bind acceptance to an immutable offer revision
  if (targetOffer.revision !== cmd.offerRevision) {
    const seller = state.traders.get(targetOffer.sellerId)
    return { ok: false, reason: 'stale_revision', outbound: [
      intent(cmd.by, 'stale_revision', {
        code: cmd.requestCode,
        ref: targetOffer.replyRef,
      }, `stale_revision:${cmd.requestCode}:${targetOffer.id}:${now.getTime()}`),
    ] }
  }

  // Check crate availability
  const crate = state.crates.get(targetOffer.crateId)
  if (!crate || crate.state !== 'available') {
    return { ok: false, reason: 'taken', outbound: [
      intent(cmd.by, 'offer_released_crate_taken', { code: cmd.requestCode },
        `crate_taken:${cmd.requestCode}:${targetOffer.crateId}:${now.getTime()}`),
    ] }
  }

  const holdId = randomUUID()
  const seller = state.traders.get(targetOffer.sellerId)!
  const at = now

  const events: DomainEvent[] = [
    {
      type: 'request_accepted',
      workspaceId: state.workspaceId,
      requestCode: cmd.requestCode,
      offerId: targetOffer.id,
      crateId: targetOffer.crateId,
      at,
    },
    {
      type: 'hold_created',
      workspaceId: state.workspaceId,
      holdId,
      requestCode: cmd.requestCode,
      offerId: targetOffer.id,
      crateId: targetOffer.crateId,
      heldUntil: req.cutoffAt,
      ...(cmd.pickupCode ? { pickupCode: cmd.pickupCode } : {}),
      at,
    },
  ]

  const outbound: OutboundIntent[] = [
    intent(cmd.by, 'offer_accepted_buyer', {
      code: cmd.requestCode,
      sellerAlias: seller.alias,
      cutoff: fmtTime(req.cutoffAt),
      ...(cmd.pickupCode ? { pickupCode: cmd.pickupCode } : {}),
    }, `accept_buyer:${cmd.requestCode}:${targetOffer.id}`),
    intent(targetOffer.sellerId, 'offer_accepted_seller', {
      code: cmd.requestCode,
      cutoff: fmtTime(req.cutoffAt),
      buyerAlias: state.traders.get(cmd.by)?.alias ?? 'Buyer',
      ...(cmd.pickupCode ? { pickupCode: cmd.pickupCode } : {}),
      record: recordLabel(state, cmd.by, true),
    }, `accept_seller:${cmd.requestCode}:${targetOffer.id}`),
  ]

  // Release all other proposed offers on this request
  for (const offer of state.offers.values()) {
    if (offer.requestCode === cmd.requestCode && offer.id !== targetOffer.id && offer.state === 'proposed') {
      events.push({
        type: 'offer_released',
        workspaceId: state.workspaceId,
        offerId: offer.id,
        requestCode: cmd.requestCode,
        crateId: offer.crateId,
        reason: 'accepted_other',
        at,
      })
      outbound.push(intent(offer.sellerId, 'offer_released_accepted_other', {
        code: cmd.requestCode,
      }, `release_other:${cmd.requestCode}:${offer.id}`))
    }
  }

  // Release any other proposed offers on the same crate from other requests
  for (const offer of state.offers.values()) {
    if (offer.crateId === targetOffer.crateId &&
        offer.requestCode !== cmd.requestCode &&
        offer.state === 'proposed') {
      events.push({
        type: 'offer_released',
        workspaceId: state.workspaceId,
        offerId: offer.id,
        requestCode: offer.requestCode,
        crateId: offer.crateId,
        reason: 'crate_taken',
        at,
      })
      // Notify the buyer of that other request
      const otherReq = state.requests.get(offer.requestCode)
      if (otherReq) {
        outbound.push(intent(otherReq.requesterId, 'offer_released_crate_taken', {
          code: offer.requestCode,
        }, `crate_taken_other:${offer.requestCode}:${offer.id}`))
      }
    }
  }

  return { ok: true, events, outbound }
}

function decideCollect(
  state: MarketState,
  cmd: Extract<Command, { kind: 'collect' }>,
  now: Date,
): Decision | Rejection {
  const req = state.requests.get(cmd.requestCode)
  if (!req) return { ok: false, reason: 'unknown_request', outbound: [] }
  const fromSeller = cmd.pickupCode !== undefined
  const hold = [...state.holds.values()].find(h => h.requestCode === cmd.requestCode &&
    (h.state === 'live' || h.state === 'collected'))
  const offer = hold ? state.offers.get(hold.offerId) : undefined
  const seller = offer ? state.traders.get(offer.sellerId) : undefined
  if (fromSeller && offer?.sellerId !== cmd.by) return { ok: false, reason: 'not_member', outbound: [] }
  if (!fromSeller && cmd.by !== req.requesterId) return { ok: false, reason: 'not_requester', outbound: [] }
  if (fromSeller && cmd.pickupCode !== hold?.pickupCode) {
    return { ok: false, reason: 'wrong_pickup_code', outbound: [
      intent(cmd.by, 'wrong_pickup_code', { code: req.code }, `wrong_pickup:${req.code}:${cmd.by}:${now.getTime()}`),
    ] }
  }

  // Idempotent: already collected returns same receipt with no events (I3)
  if (req.state === 'collected') {
    return {
      ok: true,
      events: [],
      outbound: [
        intent(cmd.by, fromSeller ? 'request_collected_seller' : 'request_collected_buyer', {
          code: cmd.requestCode,
          qty: req.quantity,
          unit: req.item.unit,
          name: req.item.name,
          sellerAlias: seller?.alias ?? 'seller',
        }, `collect_idempotent:${cmd.requestCode}:${cmd.by}`),
      ],
    }
  }

  const isClosed = req.state === 'cancelled' || req.state === 'expired'
  if (isClosed) return { ok: false, reason: 'closed', outbound: [
    intent(cmd.by, 'request_closed', {}, `closed:${cmd.requestCode}:${cmd.by}:${now.getTime()}`),
  ] }

  if (req.state !== 'held') return { ok: false, reason: 'closed', outbound: [
    intent(cmd.by, 'request_closed', {}, `notheld:${cmd.requestCode}:${cmd.by}:${now.getTime()}`),
  ] }

  if (!hold) return { ok: false, reason: 'closed', outbound: [] }

  // BUG B fix: enforce the hold deadline even when the scheduler has not yet ticked.
  if (now >= hold.heldUntil) {
    return { ok: false, reason: 'closed', outbound: [
      intent(cmd.by, 'request_closed', {}, `expired_hold:${cmd.requestCode}:${cmd.by}:${now.getTime()}`),
    ] }
  }


  const events: DomainEvent[] = [
    {
      type: 'request_collected',
      workspaceId: state.workspaceId,
      requestCode: cmd.requestCode,
      holdId: hold.id,
      crateId: hold.crateId,
      at: now,
    },
  ]

  const outbound: OutboundIntent[] = [
    intent(req.requesterId, 'request_collected_buyer', {
      code: cmd.requestCode,
      qty: req.quantity,
      unit: req.item.unit,
      name: req.item.name,
      sellerAlias: seller?.alias ?? 'seller',
    }, `collect_buyer:${cmd.requestCode}`),
  ]

  if (offer && seller) {
    outbound.push(intent(offer.sellerId, 'request_collected_seller', {
      code: cmd.requestCode,
    }, `collect_seller:${cmd.requestCode}`))
  }

  return { ok: true, events, outbound }
}

function decideWiden(
  state: MarketState,
  cmd: Extract<Command, { kind: 'widen' }>,
  now: Date,
): Decision | Rejection {
  const req = state.requests.get(cmd.requestCode)
  if (!req) return { ok: false, reason: 'unknown_request', outbound: [] }
  if (cmd.by !== req.requesterId) return { ok: false, reason: 'not_requester', outbound: [] }

  const isClosed = req.state === 'collected' || req.state === 'cancelled' || req.state === 'expired'
  if (isClosed) return { ok: false, reason: 'closed', outbound: [
    intent(cmd.by, 'request_closed', {}, `closed:${cmd.requestCode}:${cmd.by}:${now.getTime()}`),
  ] }

  if (req.state !== 'open_local') return { ok: false, reason: 'closed', outbound: [
    intent(cmd.by, 'request_closed', {}, `notwidenable:${cmd.requestCode}:${cmd.by}:${now.getTime()}`),
  ] }

  if (now >= req.cutoffAt) return { ok: false, reason: 'past_cutoff', outbound: [
    intent(cmd.by, 'request_closed', {}, `pastcutoff:${cmd.requestCode}:${cmd.by}:${now.getTime()}`),
  ] }

  const requester = state.traders.get(cmd.by)
  const circle = requester ? state.circles.get(requester.circleId) : undefined
  const area = circle?.name ?? 'local area'

  // Find coordinators to notify (I5: only after widen)
  const coordinators = [...state.traders.values()].filter(t => t.role === 'coordinator')
  const events: DomainEvent[] = [
    {
      type: 'request_widened',
      workspaceId: state.workspaceId,
      requestCode: cmd.requestCode,
      at: now,
    },
  ]
  const outbound: OutboundIntent[] = []

  for (const coord of coordinators) {
    outbound.push(intent(coord.id, 'request_widened_coordinator', {
      code: cmd.requestCode,
      qty: req.quantity,
      unit: req.item.unit,
      name: req.item.name,
      area,
      cutoff: fmtTime(req.cutoffAt),
    }, `widen_coordinator:${cmd.requestCode}:${coord.id}`))
  }

  return { ok: true, events, outbound }
}

function decideRoute(
  state: MarketState,
  cmd: Extract<Command, { kind: 'route' }>,
  now: Date,
): Decision | Rejection {
  const req = state.requests.get(cmd.requestCode)
  if (!req) return { ok: false, reason: 'unknown_request', outbound: [] }

  const coordinator = state.traders.get(cmd.by)
  if (!coordinator || coordinator.role !== 'coordinator') {
    return { ok: false, reason: 'not_coordinator', outbound: [] }
  }

  if (req.state !== 'widened') return { ok: false, reason: 'not_widened', outbound: [] }

  if (now >= req.cutoffAt) return { ok: false, reason: 'past_cutoff', outbound: [] }

  // Only one dispatch allowed per request
  if (state.dispatches.has(cmd.requestCode)) {
    return { ok: false, reason: 'already_dispatched', outbound: [] }
  }

  // Target circle must be a neighbour of some circle in the workspace
  // For simplicity: target circle must exist
  const targetCircle = state.circles.get(cmd.circleId)
  if (!targetCircle) return { ok: false, reason: 'not_neighbour', outbound: [] }

  // Check it's actually a neighbour of some requester-side circle
  const requester = state.traders.get(req.requesterId)
  const requesterCircle = requester ? state.circles.get(requester.circleId) : undefined
  if (!requesterCircle?.neighbourIds.includes(cmd.circleId)) {
    return { ok: false, reason: 'not_neighbour', outbound: [] }
  }

  // Find up to 3 non-stopped sellers in the target circle who haven't been invited
  const candidates = [...state.traders.values()].filter(
    t => t.circleId === cmd.circleId &&
      !t.stoppedAt &&
      t.role === 'trader' &&
      !req.invitedSellerIds.includes(t.id) &&
      t.id !== req.requesterId,
  ).slice(0, 3)

  const dispatchId = randomUUID()
  const at = now

  const events: DomainEvent[] = [
    {
      type: 'request_routed',
      workspaceId: state.workspaceId,
      requestCode: cmd.requestCode,
      dispatchId,
      circleId: cmd.circleId,
      routedById: cmd.by,
      invitedSellerIds: candidates.map(t => t.id),
      at,
    },
  ]

  for (const c of candidates) {
    events.push({
      type: 'seller_invited',
      workspaceId: state.workspaceId,
      requestCode: cmd.requestCode,
      sellerId: c.id,
      at,
    })
  }

  const outbound: OutboundIntent[] = candidates.map(c =>
    intent(c.id, 'request_routed_seller', {
      code: cmd.requestCode,
      qty: req.quantity,
      unit: req.item.unit,
      name: req.item.name,
      cutoff: fmtTime(req.cutoffAt),
    }, `routed_seller:${cmd.requestCode}:${c.id}`),
  )

  return { ok: true, events, outbound }
}

function decideCancel(
  state: MarketState,
  cmd: Extract<Command, { kind: 'cancel' }>,
  now: Date,
): Decision | Rejection {
  const req = state.requests.get(cmd.requestCode)
  if (!req) return { ok: false, reason: 'unknown_request', outbound: [] }
  if (cmd.by !== req.requesterId) return { ok: false, reason: 'not_requester', outbound: [] }

  const isClosed = req.state === 'collected' || req.state === 'cancelled' || req.state === 'expired'
  if (isClosed) return { ok: false, reason: 'closed', outbound: [
    intent(cmd.by, 'request_closed', {}, `closed:${cmd.requestCode}:${cmd.by}:${now.getTime()}`),
  ] }

  const at = now
  const events: DomainEvent[] = [{ type: 'request_cancelled', workspaceId: state.workspaceId, requestCode: cmd.requestCode, at }]
  const outbound: OutboundIntent[] = [
    intent(cmd.by, 'request_cancelled_buyer', { code: cmd.requestCode },
      `cancel_buyer:${cmd.requestCode}`),
  ]

  // Release any live hold
  const liveHold = [...state.holds.values()].find(
    h => h.requestCode === cmd.requestCode && h.state === 'live',
  )
  if (liveHold) {
    events.push({
      type: 'hold_released',
      workspaceId: state.workspaceId,
      holdId: liveHold.id,
      requestCode: cmd.requestCode,
      crateId: liveHold.crateId,
      reason: 'cancelled',
      at,
    })
  }

  // Notify all sellers with proposed or accepted offers
  const notifiedSellers = new Set<string>()
  for (const offer of state.offers.values()) {
    if (offer.requestCode === cmd.requestCode &&
        (offer.state === 'proposed' || offer.state === 'accepted') &&
        !notifiedSellers.has(offer.sellerId)) {
      notifiedSellers.add(offer.sellerId)
      events.push({
        type: 'offer_released',
        workspaceId: state.workspaceId,
        offerId: offer.id,
        requestCode: cmd.requestCode,
        crateId: offer.crateId,
        reason: 'cancelled',
        at,
      })
      outbound.push(intent(offer.sellerId, 'request_cancelled_seller', {
        code: cmd.requestCode,
      }, `cancel_seller:${cmd.requestCode}:${offer.id}`))
    }
  }

  return { ok: true, events, outbound }
}

function decideStop(
  state: MarketState,
  cmd: Extract<Command, { kind: 'stop' }>,
  now: Date,
): Decision | Rejection {
  const trader = state.traders.get(cmd.by)
  if (!trader) return { ok: false, reason: 'not_member', outbound: [] }

  const events: DomainEvent[] = [
    {
      type: 'trader_stopped',
      workspaceId: state.workspaceId,
      traderId: cmd.by,
      at: now,
    },
  ]

  const outbound: OutboundIntent[] = [
    intent(cmd.by, 'stop_confirmed', {}, `stop:${cmd.by}`),
  ]

  return { ok: true, events, outbound }
}

function decideTick(state: MarketState, now: Date): Decision {
  const events: DomainEvent[] = []
  const outbound: OutboundIntent[] = []

  for (const req of state.requests.values()) {
    // Skip closed requests
    if (req.state === 'collected' || req.state === 'cancelled' || req.state === 'expired') continue

    if (req.state === 'held') {
      // Check if the live hold has expired
      const liveHold = [...state.holds.values()].find(
        h => h.requestCode === req.code && h.state === 'live',
      )
      if (liveHold && now >= liveHold.heldUntil) {
        events.push({
          type: 'hold_expired',
          workspaceId: state.workspaceId,
          holdId: liveHold.id,
          requestCode: req.code,
          crateId: liveHold.crateId,
          at: now,
        })
        events.push({
          type: 'request_expired',
          workspaceId: state.workspaceId,
          requestCode: req.code,
          reason: 'hold_expired',
          at: now,
        })
        outbound.push(intent(req.requesterId, 'hold_expired_buyer', {
          code: req.code,
        }, `hold_expired:${req.code}:${now.getTime()}`))

        // Notify seller that their crate is free again (Bug D)
        const heldOffer = state.offers.get(liveHold.offerId)
        if (heldOffer) {
          outbound.push(intent(heldOffer.sellerId, 'hold_expired_seller', {
            code: req.code,
          }, `hold_expired_seller:${req.code}:${heldOffer.id}:${now.getTime()}`))
        }
      }
      continue
    }

    // Open or widened: check cutoff
    if (now >= req.cutoffAt) {
      events.push({
        type: 'request_expired',
        workspaceId: state.workspaceId,
        requestCode: req.code,
        reason: 'cutoff_passed',
        at: now,
      })
      outbound.push(intent(req.requesterId, 'request_expired_buyer', {
        code: req.code,
      }, `expired:${req.code}:${now.getTime()}`))

      // Release all proposed offers
      for (const offer of state.offers.values()) {
        if (offer.requestCode === req.code && offer.state === 'proposed') {
          events.push({
            type: 'offer_released',
            workspaceId: state.workspaceId,
            offerId: offer.id,
            requestCode: req.code,
            crateId: offer.crateId,
            reason: 'expired',
            at: now,
          })
          outbound.push(intent(offer.sellerId, 'offer_released_expired', {
            code: req.code,
          }, `offer_expired:${req.code}:${offer.id}:${now.getTime()}`))
        }
      }
      continue
    }

    // Send fallback if 30 minutes before cutoff and no hold, no fallback sent yet.
    // BUG C fix: removed `req.state !== 'widened'` guard — widened requests with no
    // confirmed pickup also need the fallback signal at the threshold.
    // Also removed `hasProposedOffer` suppression — a proposed but unaccepted offer
    // is not a confirmed pickup; the buyer still needs the fallback.
    const fallbackThreshold = minutesBefore(req.cutoffAt, 30)
    if (now >= fallbackThreshold && !req.fallbackSentAt) {
      const msLeft = req.cutoffAt.getTime() - now.getTime()
      const minsLeft = Math.floor(msLeft / 60_000)
      events.push({
        type: 'fallback_sent',
        workspaceId: state.workspaceId,
        requestCode: req.code,
        at: now,
      })
      outbound.push(intent(req.requesterId, 'fallback_buyer', {
        code: req.code,
        timeLeft: `${minsLeft} min`,
      }, `fallback:${req.code}:${now.getTime()}`))
    }
  }

  const coordinator = [...state.traders.values()].find(trader => trader.role === 'coordinator')
  if (coordinator) {
    const window = Math.floor(now.getTime() / (SHORTAGE_WINDOW_MINUTES * 60_000))
    for (const group of shortageSummary(state, now)) {
      const { circleId, item, asked, filled } = group
      const windowKey = JSON.stringify([circleId, item.name, item.grade, item.unit, window])
      if (state.shortageAlerts.has(windowKey)) continue
      events.push({ type: 'shortage_alerted', workspaceId: state.workspaceId, circleId, item, asked, filled, windowKey, at: now })
      outbound.push(intent(coordinator.id, 'shortage_alert', {
        item: item.name,
        circle: state.circles.get(circleId)?.name ?? 'Market circle',
        asked,
        filled,
      }, `shortage:${windowKey}`))
    }
  }
  return { ok: true, events, outbound }
}
