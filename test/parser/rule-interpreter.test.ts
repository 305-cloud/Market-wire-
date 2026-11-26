import type { Command as DomainCommand } from '../../src/domain/commands.js'
// test/parser/rule-interpreter.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { interpretCommand } from '../../src/parser/rule-interpreter.js'
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
// Create request
// ---------------------------------------------------------------------------

describe('interpretCommand create_request', () => {
  it('creates request and invites sellers', () => {
    let state = buildState(seedBaseEvents())

    const cmd: DomainCommand = {
      kind: 'create_request',
      by: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
    }

    const result = interpretCommand(cmd, state, T0)
    expect(result.ok).toBe(true)
    expect(result.events).toHaveLength(2) // request_created + seller_invited for ellis
    expect(result.nextState?.requests.get('E1')?.state).toBe('open_local')
  })

  it('rejects if requester not a member', () => {
    const state = buildState(seedBaseEvents())

    const cmd: DomainCommand = {
      kind: 'create_request',
      by: 'unknown',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
    }

    const result = interpretCommand(cmd, state, T0)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not_member')
  })
})

// ---------------------------------------------------------------------------
// Offer
// ---------------------------------------------------------------------------

describe('interpretCommand offer', () => {
  it('makes a new offer', () => {
    let state = buildState(seedBaseEvents())

    // Create request
    const createCmd: DomainCommand = {
      kind: 'create_request',
      by: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
    }
    const createResult = interpretCommand(createCmd, state, T0)
    if (!createResult.ok) throw new Error()
    state = createResult.nextState!

    // Ellis offers
    const offerCmd: DomainCommand = {
      kind: 'offer',
      by: 'ellis',
      requestCode: 'E1',
      priceCents: 420000,
      pickupArea: 'Cedar Lane',
    }

    const result = interpretCommand(offerCmd, state, T0)
    expect(result.ok).toBe(true)
    expect(result.events).toHaveLength(1) // offer_made
    expect(result.outbound).toHaveLength(1) // offer_received to mara

    const offers = [...result.nextState!.offers.values()]
    expect(offers).toHaveLength(1)
    expect(offers[0]?.replyRef).toBe('1')
    expect(offers[0]?.revision).toBe(1)
  })

  it('revises existing offer (increment revision)', () => {
    let state = buildState(seedBaseEvents())

    // Create request
    const createCmd: DomainCommand = {
      kind: 'create_request',
      by: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
    }
    const createResult = interpretCommand(createCmd, state, T0)
    if (!createResult.ok) throw new Error()
    state = createResult.nextState!

    // Ellis offers at 4200
    const offer1Cmd: DomainCommand = {
      kind: 'offer',
      by: 'ellis',
      requestCode: 'E1',
      priceCents: 420000,
      pickupArea: 'Cedar Lane',
    }
    const offer1Result = interpretCommand(offer1Cmd, state, T0)
    if (!offer1Result.ok) throw new Error()
    state = offer1Result.nextState!

    // Ellis revises to 5000
    const offer2Cmd: DomainCommand = {
      kind: 'offer',
      by: 'ellis',
      requestCode: 'E1',
      priceCents: 500000,
      pickupArea: 'Cedar Lane',
    }
    const result = interpretCommand(offer2Cmd, state, T0)
    expect(result.ok).toBe(true)

    const offers = [...result.nextState!.offers.values()]
    expect(offers).toHaveLength(1)
    expect(offers[0]?.priceCents).toBe(500000)
    expect(offers[0]?.revision).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

describe('interpretCommand accept', () => {
  it('accepts an offer and creates hold', () => {
    let state = buildState(seedBaseEvents())

    // Create request
    const createCmd: DomainCommand = {
      kind: 'create_request',
      by: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
    }
    const createResult = interpretCommand(createCmd, state, T0)
    if (!createResult.ok) throw new Error()
    state = createResult.nextState!

    // Ellis offers
    const offerCmd: DomainCommand = {
      kind: 'offer',
      by: 'ellis',
      requestCode: 'E1',
      priceCents: 420000,
      pickupArea: 'Cedar Lane',
    }
    const offerResult = interpretCommand(offerCmd, state, T0)
    if (!offerResult.ok) throw new Error()
    state = offerResult.nextState!

    const offer = [...state.offers.values()][0]

    // Mara accepts
    const acceptCmd: DomainCommand = {
      kind: 'accept',
      by: 'mara',
      requestCode: 'E1',
      offerRef: offer.replyRef,
      offerRevision: offer.revision,
    }
    const result = interpretCommand(acceptCmd, state, T0)
    expect(result.ok).toBe(true)
    expect(result.events).toHaveLength(2) // request_accepted + hold_created
    expect(result.nextState?.requests.get('E1')?.state).toBe('held')
  })

  it('rejects stale revision', () => {
    let state = buildState(seedBaseEvents())

    // Create request
    const createCmd: DomainCommand = {
      kind: 'create_request',
      by: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
    }
    const createResult = interpretCommand(createCmd, state, T0)
    if (!createResult.ok) throw new Error()
    state = createResult.nextState!

    // Ellis offers
    const offerCmd: DomainCommand = {
      kind: 'offer',
      by: 'ellis',
      requestCode: 'E1',
      priceCents: 420000,
      pickupArea: 'Cedar Lane',
    }
    const offerResult = interpretCommand(offerCmd, state, T0)
    if (!offerResult.ok) throw new Error()
    state = offerResult.nextState!

    const offer = [...state.offers.values()][0]

    // Ellis revises
    const reviseCmd: DomainCommand = {
      kind: 'offer',
      by: 'ellis',
      requestCode: 'E1',
      priceCents: 500000,
      pickupArea: 'Cedar Lane',
    }
    const reviseResult = interpretCommand(reviseCmd, state, T0)
    if (!reviseResult.ok) throw new Error()
    state = reviseResult.nextState!

    // Mara tries to accept with old revision
    const acceptCmd: DomainCommand = {
      kind: 'accept',
      by: 'mara',
      requestCode: 'E1',
      offerRef: offer.replyRef,
      offerRevision: 1, // old revision
    }
    const result = interpretCommand(acceptCmd, state, T0)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('stale_revision')
  })
})

// ---------------------------------------------------------------------------
// Collect (DONE)
// ---------------------------------------------------------------------------

describe('interpretCommand collect', () => {
  it('collects a held request', () => {
    let state = buildState(seedBaseEvents())

    // Create request
    const createCmd: DomainCommand = {
      kind: 'create_request',
      by: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
    }
    const createResult = interpretCommand(createCmd, state, T0)
    if (!createResult.ok) throw new Error()
    state = createResult.nextState!

    // Ellis offers
    const offerCmd: DomainCommand = {
      kind: 'offer',
      by: 'ellis',
      requestCode: 'E1',
      priceCents: 420000,
      pickupArea: 'Cedar Lane',
    }
    const offerResult = interpretCommand(offerCmd, state, T0)
    if (!offerResult.ok) throw new Error()
    state = offerResult.nextState!

    const offer = [...state.offers.values()][0]

    // Mara accepts
    const acceptCmd: DomainCommand = {
      kind: 'accept',
      by: 'mara',
      requestCode: 'E1',
      offerRef: offer.replyRef,
      offerRevision: offer.revision,
    }
    const acceptResult = interpretCommand(acceptCmd, state, T0)
    if (!acceptResult.ok) throw new Error()
    state = acceptResult.nextState!

    // Collect
    const collectCmd: DomainCommand = { kind: 'collect', by: 'mara', requestCode: 'E1' }
    const result = interpretCommand(collectCmd, state, T0)
    expect(result.ok).toBe(true)
    expect(result.events).toHaveLength(1) // request_collected
    expect(result.nextState?.requests.get('E1')?.state).toBe('collected')
  })

  it('idempotent second collect', () => {
    let state = buildState(seedBaseEvents())

    // Create request, offer, accept, collect
    const createCmd: DomainCommand = {
      kind: 'create_request',
      by: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
    }
    const createResult = interpretCommand(createCmd, state, T0)
    if (!createResult.ok) throw new Error()
    state = createResult.nextState!

    const offerCmd: DomainCommand = {
      kind: 'offer',
      by: 'ellis',
      requestCode: 'E1',
      priceCents: 420000,
      pickupArea: 'Cedar Lane',
    }
    const offerResult = interpretCommand(offerCmd, state, T0)
    if (!offerResult.ok) throw new Error()
    state = offerResult.nextState!

    const offer = [...state.offers.values()][0]

    const acceptCmd: DomainCommand = {
      kind: 'accept',
      by: 'mara',
      requestCode: 'E1',
      offerRef: offer.replyRef,
      offerRevision: offer.revision,
    }
    const acceptResult = interpretCommand(acceptCmd, state, T0)
    if (!acceptResult.ok) throw new Error()
    state = acceptResult.nextState!

    const collectCmd: DomainCommand = { kind: 'collect', by: 'mara', requestCode: 'E1' }
    const collectResult = interpretCommand(collectCmd, state, T0)
    if (!collectResult.ok) throw new Error()
    state = collectResult.nextState!

    // Second collect
    const result = interpretCommand(collectCmd, state, T0)
    expect(result.ok).toBe(true)
    expect(result.events).toHaveLength(0) // no new events
  })
})

// ---------------------------------------------------------------------------
// Widen
// ---------------------------------------------------------------------------

describe('interpretCommand widen', () => {
  it('widens an open_local request', () => {
    let state = buildState(seedBaseEvents())

    const createCmd: DomainCommand = {
      kind: 'create_request',
      by: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
    }
    const createResult = interpretCommand(createCmd, state, T0)
    if (!createResult.ok) throw new Error()
    state = createResult.nextState!

    const widenCmd: DomainCommand = { kind: 'widen', by: 'mara', requestCode: 'E1' }
    const result = interpretCommand(widenCmd, state, T0)
    expect(result.ok).toBe(true)
    expect(result.nextState?.requests.get('E1')?.state).toBe('widened')
  })
})

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe('interpretCommand cancel', () => {
  it('cancels an open request', () => {
    let state = buildState(seedBaseEvents())

    const createCmd: DomainCommand = {
      kind: 'create_request',
      by: 'mara',
      item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
      quantity: 1,
      cutoffAt: CUTOFF,
    }
    const createResult = interpretCommand(createCmd, state, T0)
    if (!createResult.ok) throw new Error()
    state = createResult.nextState!

    const cancelCmd: DomainCommand = { kind: 'cancel', by: 'mara', requestCode: 'E1' }
    const result = interpretCommand(cancelCmd, state, T0)
    expect(result.ok).toBe(true)
    expect(result.nextState?.requests.get('E1')?.state).toBe('cancelled')
  })
})

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

describe('interpretCommand stop', () => {
  it('stops a trader', () => {
    const state = buildState(seedBaseEvents())

    const stopCmd: DomainCommand = { kind: 'stop', by: 'mara' }
    const result = interpretCommand(stopCmd, state, T0)
    expect(result.ok).toBe(true)
    expect(result.nextState?.traders.get('mara')?.stoppedAt).toBeInstanceOf(Date)
  })
})
