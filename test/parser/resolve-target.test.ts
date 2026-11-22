// test/parser/resolve-target.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { resolveTarget, getPendingOffers } from '../../src/app/resolve-target.js'
import { emptyMarketState, type MarketState } from '../../src/domain/types.js'
import { evolve } from '../../src/domain/evolve.js'
import type { DomainEvent } from '../../src/domain/events.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const T0 = new Date('2026-11-21T10:00:00Z')
const CUTOFF = new Date('2026-11-21T18:00:00Z')

function seedBaseEvents(): DomainEvent[] {
  return [
    {
      type: 'circle_created', workspaceId: 'ws-test',
      circleId: 'circle-A', name: 'Cedar Lane', at: T0,
    },
    {
      type: 'trader_enrolled', workspaceId: 'ws-test',
      traderId: 'mara', alias: 'Mara', circleId: 'circle-A', role: 'trader', at: T0,
    },
    {
      type: 'trader_enrolled', workspaceId: 'ws-test',
      traderId: 'ellis', alias: 'Ellis', circleId: 'circle-A', role: 'trader', at: T0,
    },
  ] as DomainEvent[]
}

function buildState(events: DomainEvent[]): MarketState {
  return events.reduce((s, ev) => evolve(s, ev), emptyMarketState('ws-test'))
}

// ---------------------------------------------------------------------------
// Helper to create a request
// ---------------------------------------------------------------------------

function createRequest(state: MarketState, requesterId: string): { state: MarketState; code: string } {
  const req = {
    type: 'request_created' as const,
    workspaceId: 'ws-test',
    requestCode: 'E1',
    requesterId,
    item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
    quantity: 1,
    cutoffAt: CUTOFF,
    at: T0,
  }
  const nextState = evolve(state, req)
  return { state: nextState, code: 'E1' }
}

// ---------------------------------------------------------------------------
// Helper to make an offer
// ---------------------------------------------------------------------------

function makeOffer(state: MarketState, requestCode: string, sellerId: string, priceKobo: number, replyRef: string): MarketState {
  const offerEv = {
    type: 'offer_made' as const,
    workspaceId: 'ws-test',
    offerId: `offer-${sellerId}`,
    requestCode,
    crateId: `crate-${sellerId}`,
    sellerId,
    priceKobo,
    pickupArea: 'Cedar Lane',
    replyRef,
    revision: 1,
    at: T0,
  }
  return evolve(state, offerEv)
}

// ---------------------------------------------------------------------------
// Bare "1" - latest offer on active request
// ---------------------------------------------------------------------------

describe('resolveTarget bare "1"', () => {
  it('resolves to latest offer on open request', () => {
    let state = buildState(seedBaseEvents())
    const { state: s1, code } = createRequest(state, 'mara')
    state = s1

    // Ellis offers at 4200
    state = makeOffer(state, code, 'ellis', 420000, '1')

    const target = resolveTarget(state, code, 'mara', { offerRef: 1 })
    expect(target?.offer.sellerId).toBe('ellis')
    expect(target?.offer.replyRef).toBe('1')
    expect(target?.stale).toBe(false)
  })

  it('rejects stale bare "1" after revision', () => {
    let state = buildState(seedBaseEvents())
    const { state: s1, code } = createRequest(state, 'mara')
    state = s1

    // Ellis offers at 4200 (ref=1, rev=1)
    state = makeOffer(state, code, 'ellis', 420000, '1')
    const firstOffer = [...state.offers.values()].find(o => o.sellerId === 'ellis')!

    // Ellis revises to 5000 (same ref=1, rev=2)
    const revisedOfferEv = {
      type: 'offer_revised' as const,
      workspaceId: 'ws-test',
      offerId: firstOffer.id,
      requestCode: code,
      priceKobo: 500000,
      pickupArea: 'Cedar Lane',
      revision: 2,
      at: T0,
    }
    state = evolve(state, revisedOfferEv)

    // Mara's old SMS said "1" referring to rev=1
    const target = resolveTarget(state, code, 'mara', { offerRef: 1 })
    expect(target?.offer.replyRef).toBe('1')
    expect(target?.stale).toBe(true)
  })

  it('rejects when no active request', () => {
    const state = buildState(seedBaseEvents())
    const target = resolveTarget(state, undefined, 'mara', { offerRef: 1 })
    expect(target).toBeNull()
  })

  it('rejects when multiple open requests (ambiguous)', () => {
    let state = buildState(seedBaseEvents())

    // Create two requests
    const req1 = {
      type: 'request_created' as const,
      workspaceId: 'ws-test',
      requestCode: 'E1',
      requesterId: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
      at: T0,
    }
    state = evolve(state, req1)

    const req2 = {
      type: 'request_created' as const,
      workspaceId: 'ws-test',
      requestCode: 'E2',
      requesterId: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
      at: T0,
    }
    state = evolve(state, req2)

    // Should be ambiguous - no single active request
    const target = resolveTarget(state, undefined, 'mara', { offerRef: 1 })
    expect(target).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Coded "1 E7"
// ---------------------------------------------------------------------------

describe('resolveTarget "1 E7"', () => {
  it('resolves specific request and offer ref', () => {
    let state = buildState(seedBaseEvents())

    // Create E7
    const reqEv = {
      type: 'request_created' as const,
      workspaceId: 'ws-test',
      requestCode: 'E7',
      requesterId: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
      at: T0,
    }
    state = evolve(state, reqEv)

    // Offer with ref=1
    state = makeOffer(state, 'E7', 'ellis', 420000, '1')

    const target = resolveTarget(state, 'E7', 'mara', { offerRef: 1, code: 'E7' })
    expect(target?.offer.sellerId).toBe('ellis')
    expect(target?.offer.requestCode).toBe('E7')
    expect(target?.stale).toBe(false)
  })

  it('rejects if offer not found', () => {
    const state = buildState(seedBaseEvents())
    const target = resolveTarget(state, 'E7', 'mara', { offerRef: 1, code: 'E7' })
    expect(target).toBeNull()
  })

  it('rejects if request not found', () => {
    let state = buildState(seedBaseEvents())
    const reqEv = {
      type: 'request_created' as const,
      workspaceId: 'ws-test',
      requestCode: 'E7',
      requesterId: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
      at: T0,
    }
    state = evolve(state, reqEv)
    const target = resolveTarget(state, undefined, 'mara', { offerRef: 1, code: 'E99' })
    expect(target).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getPendingOffers
// ---------------------------------------------------------------------------

describe('getPendingOffers', () => {
  it('returns offers for open request', () => {
    let state = buildState(seedBaseEvents())
    const { state: s1, code } = createRequest(state, 'mara')
    state = s1

    state = makeOffer(state, code, 'ellis', 420000, '1')

    const pending = getPendingOffers(state, 'mara')
    expect(pending).toEqual({
      requestCode: code,
      offers: [
        { ref: '1', sellerAlias: 'Ellis', priceKobo: 420000, pickupArea: 'Cedar Lane' },
      ],
    })
  })

  it('returns null when no active request', () => {
    const state = buildState(seedBaseEvents())
    const pending = getPendingOffers(state, 'mara')
    expect(pending).toBeNull()
  })

  it('returns null when multiple active requests (ambiguous)', () => {
    let state = buildState(seedBaseEvents())

    // Two requests
    const req1 = {
      type: 'request_created' as const,
      workspaceId: 'ws-test',
      requestCode: 'E1',
      requesterId: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
      at: T0,
    }
    state = evolve(state, req1)

    const req2 = {
      type: 'request_created' as const,
      workspaceId: 'ws-test',
      requestCode: 'E2',
      requesterId: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
      at: T0,
    }
    state = evolve(state, req2)

    const pending = getPendingOffers(state, 'mara')
    expect(pending).toBeNull()
  })
})