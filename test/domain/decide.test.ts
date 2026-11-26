// test/domain/decide.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { decide } from '../../src/domain/decide.js'
import { evolve, replayEvents } from '../../src/domain/evolve.js'
import { checkInvariants } from '../../src/domain/invariants.js'
import { emptyMarketState } from '../../src/domain/types.js'
import type { MarketState } from '../../src/domain/types.js'
import type { DomainEvent } from '../../src/domain/events.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildState(events: DomainEvent[]): MarketState {
  return events.reduce(evolve, emptyMarketState('ws-test'))
}

const item = { name: 'eggs', grade: 'medium', unit: 'crate30' }

/** Seed the workspace with two circles, traders and a coordinator */
function seedBaseEvents(): DomainEvent[] {
  const now = new Date('2026-11-21T10:00:00Z')
  return [
    // Circles
    {
      type: 'circle_created', workspaceId: 'ws-test',
      circleId: 'circle-A', name: 'Cedar Lane', at: now,
    },
    {
      type: 'circle_created', workspaceId: 'ws-test',
      circleId: 'circle-B', name: 'North Arcade', at: now,
    },
    {
      type: 'circle_linked', workspaceId: 'ws-test',
      circleId: 'circle-A', neighbourId: 'circle-B', at: now,
    },
    // Traders in circle A
    {
      type: 'trader_enrolled', workspaceId: 'ws-test',
      traderId: 'mara', alias: 'Mara', circleId: 'circle-A', role: 'trader', at: now,
    },
    {
      type: 'trader_enrolled', workspaceId: 'ws-test',
      traderId: 'ellis', alias: 'Ellis', circleId: 'circle-A', role: 'trader', at: now,
    },
    {
      type: 'trader_enrolled', workspaceId: 'ws-test',
      traderId: 'casey', alias: 'Casey', circleId: 'circle-A', role: 'trader', at: now,
    },
    // Traders in circle B
    {
      type: 'trader_enrolled', workspaceId: 'ws-test',
      traderId: 'rowan', alias: 'Rowan', circleId: 'circle-B', role: 'trader', at: now,
    },
    {
      type: 'trader_enrolled', workspaceId: 'ws-test',
      traderId: 'avery', alias: 'Avery', circleId: 'circle-B', role: 'trader', at: now,
    },
    {
      type: 'trader_enrolled', workspaceId: 'ws-test',
      traderId: 'quinn', alias: 'Quinn', circleId: 'circle-B', role: 'trader', at: now,
    },
    // Coordinator
    {
      type: 'trader_enrolled', workspaceId: 'ws-test',
      traderId: 'coord', alias: 'Coordinator', circleId: 'circle-A', role: 'coordinator', at: now,
    },
  ] as DomainEvent[]
}

const T0 = new Date('2026-11-21T10:00:00Z')
const CUTOFF = new Date('2026-11-21T18:00:00Z')
const AFTER_CUTOFF = new Date('2026-11-21T18:01:00Z')

function createRequest(state: MarketState): { state: MarketState; code: string } {
  const d = decide(state, { kind: 'create_request', by: 'mara', item, quantity: 1, cutoffAt: CUTOFF }, T0)
  if (!d.ok) throw new Error('create_request failed: ' + ('reason' in d ? d.reason : ''))
  const nextState = d.events.reduce(evolve, state)
  const code = [...nextState.requests.keys()].pop()!
  return { state: nextState, code }
}

// ---------------------------------------------------------------------------
// R_accept_one_hold: two offers → accept one → the other is released
// ---------------------------------------------------------------------------

describe('R_accept_one_hold', () => {
  it('accepting one offer releases all others on the request', () => {
    let state = buildState(seedBaseEvents())
    const { state: s1, code } = createRequest(state)
    state = s1

    // Ellis offers
    const offer1 = decide(state, {
      kind: 'offer', by: 'ellis', requestCode: code, priceKobo: 420000, pickupArea: 'Cedar Lane',
    }, T0)
    expect(offer1.ok).toBe(true)
    if (!offer1.ok) throw new Error()
    state = offer1.events.reduce(evolve, state)

    // Casey offers
    const offer2 = decide(state, {
      kind: 'offer', by: 'casey', requestCode: code, priceKobo: 400000, pickupArea: 'Cedar Lane',
    }, T0)
    expect(offer2.ok).toBe(true)
    if (!offer2.ok) throw new Error()
    state = offer2.events.reduce(evolve, state)

    // Find offer IDs and refs
    const boseOffer = [...state.offers.values()].find(o => o.sellerId === 'ellis')!
    const kemiOffer = [...state.offers.values()].find(o => o.sellerId === 'casey')!
    expect(boseOffer.state).toBe('proposed')
    expect(kemiOffer.state).toBe('proposed')

    // Mara accepts Ellis's offer
    const accept = decide(state, {
      kind: 'accept',
      by: 'mara',
      requestCode: code,
      offerRef: boseOffer.replyRef,
      offerRevision: boseOffer.revision,
    }, T0)
    expect(accept.ok).toBe(true)
    if (!accept.ok) throw new Error()
    state = accept.events.reduce(evolve, state)

    // Casey's offer must be released
    const kemiPost = state.offers.get(kemiOffer.id)!
    expect(kemiPost.state).toBe('released')

    // Request must be held
    const req = state.requests.get(code)!
    expect(req.state).toBe('held')

    // Invariants pass
    const allOutbound = [...offer1.outbound, ...offer2.outbound, ...accept.outbound]
    expect(checkInvariants(state, allOutbound)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// R_taken: same crate offered to E7 and E8; E7 accepts; E8's accept is rejected
// ---------------------------------------------------------------------------

describe('R_taken', () => {
  it('a crate held for one request cannot be held for another', () => {
    let state = buildState(seedBaseEvents())

    // Mara creates E7, Casey creates E8 (we need a second requester — use Casey as a buyer)
    // Actually let's use a different trader as the second requester by enrolling one
    // For this test we use Mara for E7 and Ellis as a "second requester" won't work since Ellis
    // is in circle-A as a trader.  Let's just enrol a second requester.
    const extraEvent: DomainEvent = {
      type: 'trader_enrolled', workspaceId: 'ws-test',
      traderId: 'jules', alias: 'Jules', circleId: 'circle-A', role: 'trader', at: T0,
    }
    state = evolve(state, extraEvent)

    // Mara creates request E1
    const { state: s1, code: codeE1 } = createRequest(state)
    state = s1

    // Jules creates request E2
    const d2 = decide(state, {
      kind: 'create_request', by: 'jules', item, quantity: 1, cutoffAt: CUTOFF,
    }, T0)
    expect(d2.ok).toBe(true)
    if (!d2.ok) throw new Error()
    state = d2.events.reduce(evolve, state)
    const codeE2 = [...state.requests.keys()].at(-1)!

    // Ellis offers to both requests (same crate will be reused)
    const o1 = decide(state, {
      kind: 'offer', by: 'ellis', requestCode: codeE1, priceKobo: 420000, pickupArea: 'Cedar Lane',
    }, T0)
    expect(o1.ok).toBe(true)
    if (!o1.ok) throw new Error()
    state = o1.events.reduce(evolve, state)

    // Ellis invites herself to E2 — but Ellis isn't invited to Jules's E2 yet
    // We need to invite Ellis; she's in circle-A with Jules so she was auto-invited
    const o2 = decide(state, {
      kind: 'offer', by: 'ellis', requestCode: codeE2, priceKobo: 420000, pickupArea: 'Cedar Lane',
    }, T0)
    expect(o2.ok).toBe(true)
    if (!o2.ok) throw new Error()
    state = o2.events.reduce(evolve, state)

    const boseOfferE1 = [...state.offers.values()].find(o => o.sellerId === 'ellis' && o.requestCode === codeE1)!
    const boseOfferE2 = [...state.offers.values()].find(o => o.sellerId === 'ellis' && o.requestCode === codeE2)!

    // Verify they point to the same crate
    expect(boseOfferE1.crateId).toBe(boseOfferE2.crateId)

    // Mara accepts E1
    const acc1 = decide(state, {
      kind: 'accept', by: 'mara', requestCode: codeE1,
      offerRef: boseOfferE1.replyRef, offerRevision: boseOfferE1.revision,
    }, T0)
    expect(acc1.ok).toBe(true)
    if (!acc1.ok) throw new Error()
    state = acc1.events.reduce(evolve, state)

    // The E2 offer should be released now (crate taken)
    const boseE2Post = state.offers.get(boseOfferE2.id)!
    expect(boseE2Post.state).toBe('released')

    // Jules tries to accept E2 — should fail
    const acc2 = decide(state, {
      kind: 'accept', by: 'jules', requestCode: codeE2,
      offerRef: boseOfferE2.replyRef, offerRevision: boseOfferE2.revision,
    }, T0)
    expect(acc2.ok).toBe(false)
    expect(acc2.ok === false && acc2.reason).toMatch(/taken|unknown_request/)
  })
})

// ---------------------------------------------------------------------------
// R_done_idempotent: second collect returns ok:true with events.length === 0
// ---------------------------------------------------------------------------

describe('R_done_idempotent', () => {
  it('second DONE returns same receipt with no events', () => {
    let state = buildState(seedBaseEvents())
    const { state: s1, code } = createRequest(state)
    state = s1

    // Ellis offers
    const o = decide(state, {
      kind: 'offer', by: 'ellis', requestCode: code, priceKobo: 420000, pickupArea: 'Cedar Lane',
    }, T0)
    if (!o.ok) throw new Error()
    state = o.events.reduce(evolve, state)

    const boseOffer = [...state.offers.values()].find(o => o.sellerId === 'ellis')!

    // Mara accepts
    const acc = decide(state, {
      kind: 'accept', by: 'mara', requestCode: code,
      offerRef: boseOffer.replyRef, offerRevision: boseOffer.revision,
    }, T0)
    if (!acc.ok) throw new Error()
    state = acc.events.reduce(evolve, state)

    // First collect
    const c1 = decide(state, { kind: 'collect', by: 'mara', requestCode: code }, T0)
    expect(c1.ok).toBe(true)
    if (!c1.ok) throw new Error()
    state = c1.events.reduce(evolve, state)
    expect(c1.events.length).toBeGreaterThan(0)

    // Second collect — idempotent
    const c2 = decide(state, { kind: 'collect', by: 'mara', requestCode: code }, T0)
    expect(c2.ok).toBe(true)
    if (!c2.ok) throw new Error()
    expect(c2.events).toHaveLength(0)
    // Same receipt template
    expect(c2.outbound[0]?.template).toBe('request_collected_buyer')
  })
})

// ---------------------------------------------------------------------------
// R_closed_after_cutoff: accept at cutoff+1min is rejected
// ---------------------------------------------------------------------------

describe('R_closed_after_cutoff', () => {
  it('accept after cutoff is rejected with past_cutoff', () => {
    let state = buildState(seedBaseEvents())
    const { state: s1, code } = createRequest(state)
    state = s1

    const o = decide(state, {
      kind: 'offer', by: 'ellis', requestCode: code, priceKobo: 420000, pickupArea: 'Cedar Lane',
    }, T0)
    if (!o.ok) throw new Error()
    state = o.events.reduce(evolve, state)

    const boseOffer = [...state.offers.values()].find(o => o.sellerId === 'ellis')!

    const acc = decide(state, {
      kind: 'accept', by: 'mara', requestCode: code,
      offerRef: boseOffer.replyRef, offerRevision: boseOffer.revision,
    }, AFTER_CUTOFF)
    expect(acc.ok).toBe(false)
    if (acc.ok) throw new Error()
    expect(acc.reason).toBe('past_cutoff')
  })
})

// ---------------------------------------------------------------------------
// R_no_coordinator_before_widen: coordinator gets no outbound before widen
// ---------------------------------------------------------------------------

describe('R_no_coordinator_before_widen', () => {
  it('no outbound to coordinator before widen', () => {
    let state = buildState(seedBaseEvents())
    const { state: s1, code } = createRequest(state)
    state = s1

    // Collect all outbound from create_request (which should be seller_invited + request_confirmed)
    const createDecision = decide(buildState(seedBaseEvents()), {
      kind: 'create_request', by: 'mara', item, quantity: 1, cutoffAt: CUTOFF,
    }, T0)
    if (!createDecision.ok) throw new Error()

    for (const ob of createDecision.outbound) {
      const trader = state.traders.get(ob.to)
      expect(trader?.role).not.toBe('coordinator')
    }

    // Offer
    const o = decide(state, {
      kind: 'offer', by: 'ellis', requestCode: code, priceKobo: 420000, pickupArea: 'Cedar Lane',
    }, T0)
    if (!o.ok) throw new Error()
    for (const ob of o.outbound) {
      const trader = state.traders.get(ob.to)
      expect(trader?.role).not.toBe('coordinator')
    }
  })
})

// ---------------------------------------------------------------------------
// R_route_cap_3: neighbouring circle with 5 sellers gets exactly 3 invitations
// ---------------------------------------------------------------------------

describe('R_route_cap_3', () => {
  it('route caps invitations at 3 sellers', () => {
    // Build a state with 5 sellers in circle-B
    const baseEvents = seedBaseEvents()
    // Add 2 more sellers to circle-B
    const extra: DomainEvent[] = [
      { type: 'trader_enrolled', workspaceId: 'ws-test', traderId: 'jules', alias: 'Jules', circleId: 'circle-B', role: 'trader', at: T0 },
      { type: 'trader_enrolled', workspaceId: 'ws-test', traderId: 'ngozi', alias: 'Ngozi', circleId: 'circle-B', role: 'trader', at: T0 },
    ] as DomainEvent[]

    let state = buildState([...baseEvents, ...extra])
    const { state: s1, code } = createRequest(state)
    state = s1

    // Widen first
    const w = decide(state, { kind: 'widen', by: 'mara', requestCode: code }, T0)
    if (!w.ok) throw new Error()
    state = w.events.reduce(evolve, state)

    // Route to circle-B
    const r = decide(state, {
      kind: 'route', by: 'coord', requestCode: code, circleId: 'circle-B',
    }, T0)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('route failed: ' + r.reason)

    // Count invitations to circle-B sellers
    const invitations = r.outbound.filter(ob => {
      const trader = state.traders.get(ob.to)
      return trader?.circleId === 'circle-B'
    })
    expect(invitations).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// R_stale_revision: accepting with wrong revision is rejected
// ---------------------------------------------------------------------------

describe('R_stale_revision', () => {
  it('accepting with a stale revision is rejected', () => {
    let state = buildState(seedBaseEvents())
    const { state: s1, code } = createRequest(state)
    state = s1

    // Ellis offers at 4200
    const o1 = decide(state, {
      kind: 'offer', by: 'ellis', requestCode: code, priceKobo: 420000, pickupArea: 'Cedar Lane',
    }, T0)
    if (!o1.ok) throw new Error()
    state = o1.events.reduce(evolve, state)

    const boseOffer = [...state.offers.values()].find(o => o.sellerId === 'ellis')!
    expect(boseOffer.revision).toBe(1)

    // Ellis revises to 5000
    const o2 = decide(state, {
      kind: 'offer', by: 'ellis', requestCode: code, priceKobo: 500000, pickupArea: 'Cedar Lane',
    }, T0)
    if (!o2.ok) throw new Error()
    state = o2.events.reduce(evolve, state)

    const boseOfferRevised = state.offers.get(boseOffer.id)!
    expect(boseOfferRevised.revision).toBe(2)

    // Mara tries to accept with old revision 1
    const acc = decide(state, {
      kind: 'accept', by: 'mara', requestCode: code,
      offerRef: boseOffer.replyRef, offerRevision: 1,
    }, T0)
    expect(acc.ok).toBe(false)
    if (acc.ok) throw new Error()
    expect(acc.reason).toBe('stale_revision')
  })
})

// ---------------------------------------------------------------------------
// R_widen_then_route: E8 flow — widen, coordinator routes, seller invited
// ---------------------------------------------------------------------------

describe('R_widen_then_route', () => {
  it('coordinator receives case after widen and can route to neighbour', () => {
    let state = buildState(seedBaseEvents())
    const { state: s1, code } = createRequest(state)
    state = s1

    // Widen
    const w = decide(state, { kind: 'widen', by: 'mara', requestCode: code }, T0)
    expect(w.ok).toBe(true)
    if (!w.ok) throw new Error()

    // Coordinator gets notified
    const coordOutbound = w.outbound.filter(ob => ob.to === 'coord')
    expect(coordOutbound).toHaveLength(1)
    expect(coordOutbound[0]?.template).toBe('request_widened_coordinator')

    state = w.events.reduce(evolve, state)

    // Route to circle-B
    const r = decide(state, {
      kind: 'route', by: 'coord', requestCode: code, circleId: 'circle-B',
    }, T0)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('route failed: ' + r.reason)

    state = r.events.reduce(evolve, state)

    // Check sellers in circle-B were invited
    const req = state.requests.get(code)!
    const circleBSellers = ['rowan', 'avery', 'quinn']
    for (const id of circleBSellers) {
      expect(req.invitedSellerIds).toContain(id)
    }

    // No double dispatch
    const r2 = decide(state, {
      kind: 'route', by: 'coord', requestCode: code, circleId: 'circle-B',
    }, T0)
    expect(r2.ok).toBe(false)
    if (r2.ok) throw new Error()
    expect(r2.reason).toBe('already_dispatched')
  })
})

// ---------------------------------------------------------------------------
// R_replay_invariant: folding evolve over emitted events reproduces state
// ---------------------------------------------------------------------------

describe('R_replay_invariant', () => {
  it('replaying events from empty produces the same state', () => {
    let state = buildState(seedBaseEvents())
    const allEvents: DomainEvent[] = [...seedBaseEvents()]

    const { state: s1, code } = createRequest(state)
    // Gather events from create_request
    const createDecision = decide(state, {
      kind: 'create_request', by: 'mara', item, quantity: 1, cutoffAt: CUTOFF,
    }, T0)
    if (!createDecision.ok) throw new Error()
    allEvents.push(...createDecision.events)
    state = s1

    // Offer
    const o = decide(state, {
      kind: 'offer', by: 'ellis', requestCode: code, priceKobo: 420000, pickupArea: 'Cedar Lane',
    }, T0)
    if (!o.ok) throw new Error()
    allEvents.push(...o.events)
    state = o.events.reduce(evolve, state)

    const boseOffer = [...state.offers.values()].find(o => o.sellerId === 'ellis')!

    // Accept
    const acc = decide(state, {
      kind: 'accept', by: 'mara', requestCode: code,
      offerRef: boseOffer.replyRef, offerRevision: boseOffer.revision,
    }, T0)
    if (!acc.ok) throw new Error()
    allEvents.push(...acc.events)
    state = acc.events.reduce(evolve, state)

    // Replay from empty
    const replayed = replayEvents(allEvents, 'ws-test')

    // Compare key structures
    expect(replayed.requests.size).toBe(state.requests.size)
    expect(replayed.holds.size).toBe(state.holds.size)
    expect(replayed.offers.size).toBe(state.offers.size)
    expect(replayed.crates.size).toBe(state.crates.size)

    // State of request must match
    const reqOriginal = state.requests.get(code)!
    const reqReplayed = replayed.requests.get(code)!
    expect(reqReplayed.state).toBe(reqOriginal.state)

    // Hold states must match
    for (const [id, hold] of state.holds) {
      expect(replayed.holds.get(id)?.state).toBe(hold.state)
    }
  })
})

// ---------------------------------------------------------------------------
// R_fallback_once: tick sends at most one fallback across multiple ticks
// ---------------------------------------------------------------------------

describe('R_fallback_once', () => {
  it('only one fallback message is sent even after many ticks', () => {
    let state = buildState(seedBaseEvents())
    const { state: s1, code } = createRequest(state)
    state = s1

    // Tick at 31 minutes before cutoff (outside the 30-minute fallback threshold)
    const beforeThreshold = new Date(CUTOFF.getTime() - 31 * 60_000)
    const tick1 = decide(state, { kind: 'tick' }, beforeThreshold)
    expect(tick1.ok).toBe(true)
    if (!tick1.ok) throw new Error()
    expect(tick1.outbound.filter(o => o.template === 'fallback_buyer')).toHaveLength(0)

    // Tick at exactly 30 min before cutoff
    const atThreshold = new Date(CUTOFF.getTime() - 30 * 60_000)
    const tick2 = decide(state, { kind: 'tick' }, atThreshold)
    expect(tick2.ok).toBe(true)
    if (!tick2.ok) throw new Error()
    const fallbacks = tick2.outbound.filter(o => o.template === 'fallback_buyer')
    expect(fallbacks).toHaveLength(1)
    state = tick2.events.reduce(evolve, state)

    // Another tick — no second fallback
    const tick3 = decide(state, { kind: 'tick' }, atThreshold)
    expect(tick3.ok).toBe(true)
    if (!tick3.ok) throw new Error()
    expect(tick3.outbound.filter(o => o.template === 'fallback_buyer')).toHaveLength(0)
  })
})
