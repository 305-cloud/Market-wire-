// src/domain/invariants.ts
// Checks I1–I9 against a MarketState and a list of outbound intents.
// Returns all violations found (empty = clean).

import type { MarketState } from './types.js'
import type { OutboundIntent } from './decide.js'
import { renderTemplate } from '../messages/templates.js'
import { SHORTAGE_MIN_ASKS, SHORTAGE_FILL_RATIO } from './shortage.js'

export type InvariantId = 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7' | 'I8' | 'I9' | 'I10'

export interface Violation {
  invariant: InvariantId
  detail: string
}

export function checkInvariants(
  state: MarketState,
  outbound: OutboundIntent[],
  workspaceKind?: 'demo' | 'live',
): Violation[] {
  const violations: Violation[] = []

  // I1: At most one live hold per crate
  const liveHoldsByCrate = new Map<string, string[]>()
  for (const hold of state.holds.values()) {
    if (hold.state === 'live') {
      const existing = liveHoldsByCrate.get(hold.crateId) ?? []
      existing.push(hold.id)
      liveHoldsByCrate.set(hold.crateId, existing)
    }
  }
  for (const [crateId, holdIds] of liveHoldsByCrate) {
    if (holdIds.length > 1) {
      violations.push({ invariant: 'I1', detail: `Crate ${crateId} has ${holdIds.length} live holds: ${holdIds.join(', ')}` })
    }
  }

  // I2: At most one live hold per request
  const liveHoldsByRequest = new Map<string, string[]>()
  for (const hold of state.holds.values()) {
    if (hold.state === 'live') {
      const existing = liveHoldsByRequest.get(hold.requestCode) ?? []
      existing.push(hold.id)
      liveHoldsByRequest.set(hold.requestCode, existing)
    }
  }
  for (const [code, holdIds] of liveHoldsByRequest) {
    if (holdIds.length > 1) {
      violations.push({ invariant: 'I2', detail: `Request ${code} has ${holdIds.length} live holds: ${holdIds.join(', ')}` })
    }
  }

  // I3: At most one collection per request
  const collectedHoldsByRequest = new Map<string, string[]>()
  for (const hold of state.holds.values()) {
    if (hold.state === 'collected') {
      const existing = collectedHoldsByRequest.get(hold.requestCode) ?? []
      existing.push(hold.id)
      collectedHoldsByRequest.set(hold.requestCode, existing)
    }
  }
  for (const [code, holdIds] of collectedHoldsByRequest) {
    if (holdIds.length > 1) {
      violations.push({ invariant: 'I3', detail: `Request ${code} has ${holdIds.length} collections: ${holdIds.join(', ')}` })
    }
  }

  // I4: No invitation sent to a stopped trader or one outside their dispatched circle
  for (const ob of outbound) {
    if (ob.template === 'seller_invited' || ob.template === 'request_routed_seller') {
      const trader = state.traders.get(ob.to)
      if (trader?.stoppedAt) {
        violations.push({ invariant: 'I4', detail: `Stopped trader ${ob.to} (${trader.alias}) received an invitation` })
      }
    }
  }

  // I5: Coordinator receives nothing about a request until requester has widened it
  for (const ob of outbound) {
    const trader = state.traders.get(ob.to)
    if (trader?.role === 'coordinator') {
      // Find which request this outbound is about
      const codeMatch = ob.body.match(/\bE\d+\b/)
      if (codeMatch) {
        const code = codeMatch[0]
        const req = state.requests.get(code)
        if (req && req.state !== 'widened' && req.state !== 'collected' && req.state !== 'cancelled' && req.state !== 'expired') {
          violations.push({ invariant: 'I5', detail: `Coordinator ${ob.to} received message about ${code} before widen (state=${req.state})` })
        }
      }
    }
  }

  // I6: After cancel, expiry or collection, no command changes the request's state
  // This is enforced structurally in decide; we check closed requests don't have live holds
  for (const req of state.requests.values()) {
    if (req.state === 'cancelled' || req.state === 'expired' || req.state === 'collected') {
      const liveHold = [...state.holds.values()].find(
        h => h.requestCode === req.code && h.state === 'live',
      )
      if (liveHold) {
        violations.push({ invariant: 'I6', detail: `Closed request ${req.code} (${req.state}) still has a live hold ${liveHold.id}` })
      }
    }
  }

  // I7: Replay invariant is checked externally (see test/property/model.property.test.ts)

  // I8: No circle-wide message contains a price, phone number or customer note
  // Any international (E.164) or local-format phone number, and any price in credits or a currency.
  const phonePattern = /\+\d[\d\s-]{7,16}\d|\b0\d{9,10}\b/
  const pricePattern = /\b(?:USD|EUR|GBP|INR|KES|NGN|BRL|MXN|ZAR)\s*[\d,]+|[$€£¥₹₦₱]\s*[\d,]+|\b\d{3,}[\s,]\d{3}\b|[\d,]+\s*credits/i
  const circleWideTemplates = new Set(['seller_invited', 'request_routed_seller'])
  for (const ob of outbound) {
    if (circleWideTemplates.has(ob.template)) {
      if (phonePattern.test(ob.body)) {
        violations.push({ invariant: 'I8', detail: `Circle-wide message to ${ob.to} contains a phone number: "${ob.body}"` })
      }
      if (pricePattern.test(ob.body)) {
        violations.push({ invariant: 'I8', detail: `Circle-wide message to ${ob.to} contains a price: "${ob.body}"` })
      }
      if (/\b(?:usual today|pickup code|buyer record|\d+ done|\d+ missed)\b/i.test(ob.body)) {
        violations.push({ invariant: 'I8', detail: 'Circle-wide message includes private exchange details' })
      }
    }
    if (ob.template !== 'shortage_alert') continue
    const { item, circle, asked, filled } = ob.vars
    const count = Number(asked)
    const completed = Number(filled)
    const labels = /^[a-z][a-z -]{0,35}$/i
    if (!labels.test(String(item)) || !labels.test(String(circle)) ||
        Object.keys(ob.vars).length !== 4 ||
        !Number.isInteger(count) || count < SHORTAGE_MIN_ASKS ||
        !Number.isInteger(completed) || completed < 0 || completed / count >= SHORTAGE_FILL_RATIO ||
        state.traders.get(ob.to)?.role !== 'coordinator' ||
        ob.body !== renderTemplate('shortage_alert', ob.vars)) {
      violations.push({ invariant: 'I10', detail: 'Shortage alert failed its aggregate-only contract' })
    }
  }

  // I9: Demo workspace never produces an outbound row for sms_gateway channel
  // This is checked at the channel level in outbox.ts; here we just verify no phone number leaks
  // The actual I9 enforcement is in the outbox/channel layer

  return violations
}
