import type { Command as DomainCommand } from '../../src/domain/commands.js'
// test/parser/interpret.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { interpret, parseSellerQuote, parseCreateRequest } from '../../src/parser/interpret.js'
import { emptyMarketState, type MarketState } from '../../src/domain/types.js'
import { evolve } from '../../src/domain/evolve.js'
import type { DomainEvent } from '../../src/domain/events.js'
import { interpretCommand } from '../../src/parser/rule-interpreter.js'

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
      type: 'circle_created', workspaceId: 'ws-test',
      circleId: 'circle-B', name: 'North Arcade', at: T0,
    },
    {
      type: 'circle_linked', workspaceId: 'ws-test',
      circleId: 'circle-A', neighbourId: 'circle-B', at: T0,
    },
    {
      type: 'trader_enrolled', workspaceId: 'ws-test',
      traderId: 'mara', alias: 'Mara', circleId: 'circle-A', role: 'trader', at: T0,
    },
    {
      type: 'trader_enrolled', workspaceId: 'ws-test',
      traderId: 'ellis', alias: 'Ellis', circleId: 'circle-A', role: 'trader', at: T0,
    },
    {
      type: 'trader_enrolled', workspaceId: 'ws-test',
      traderId: 'coord', alias: 'Coordinator', circleId: 'circle-A', role: 'coordinator', at: T0,
    },
  ] as DomainEvent[]
}

function buildState(events: DomainEvent[]): MarketState {
  return events.reduce((s, ev) => evolve(s, ev), emptyMarketState('ws-test'))
}

// ---------------------------------------------------------------------------
// STOP and HELP
// ---------------------------------------------------------------------------

describe('STOP and HELP', () => {
  it('STOP pauses invitations', () => {
    const state = buildState(seedBaseEvents())
    const cmd = interpret('STOP', state, 'mara')
    expect(cmd).toEqual({ kind: 'stop', by: 'mara' })
  })

  it('leaves HELP for the channel to answer without a domain mutation', () => {
    const state = buildState(seedBaseEvents())
    const cmd = interpret('HELP', state, 'mara')
    expect(cmd).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// DONE / collect
// ---------------------------------------------------------------------------

describe('DONE / collect', () => {
  it('DONE on a held request creates collect command', () => {
    let state = buildState(seedBaseEvents())

    // Create request
    const createCmd: DomainCommand = { kind: 'create_request', by: 'mara', item: { name: 'eggs', grade: 'medium', unit: 'crate30' }, quantity: 1, cutoffAt: CUTOFF }
    const createResult = interpretCommand(createCmd, state, T0)
    if (!createResult.ok) throw new Error()
    state = createResult.nextState!

    // Ellis offers
    const offerCmd: DomainCommand = { kind: 'offer', by: 'ellis', requestCode: 'E1', priceCents: 420000, pickupArea: 'Cedar Lane' }
    const offerResult = interpretCommand(offerCmd, state, T0)
    if (!offerResult.ok) throw new Error()
    state = offerResult.nextState!

    const offer = [...state.offers.values()][0]

    // Mara accepts
    const acceptCmd: DomainCommand = { kind: 'accept', by: 'mara', requestCode: 'E1', offerRef: offer.replyRef, offerRevision: offer.revision }
    const acceptResult = interpretCommand(acceptCmd, state, T0)
    if (!acceptResult.ok) throw new Error()
    state = acceptResult.nextState!

    // DONE
    const doneCmd: DomainCommand = { kind: 'collect', by: 'mara', requestCode: 'E1' }
    const doneResult = interpretCommand(doneCmd, state, T0)
    expect(doneResult.ok).toBe(true)
    expect(doneResult.events).toHaveLength(1)
    expect(doneResult.nextState?.requests.get('E1')?.state).toBe('collected')
  })
})

// ---------------------------------------------------------------------------
// Seller quote parsing
// ---------------------------------------------------------------------------

describe('parseSellerQuote', () => {
  it('converts 4200 whole credits to integer minor units', () => {
    const cmd = parseSellerQuote('E7 4200 Cedar Lane', 'ellis')
    expect(cmd).toEqual({
      kind: 'offer',
      by: 'ellis',
      requestCode: 'E7',
      priceCents: 420000,
      pickupArea: 'Cedar Lane',
    })
  })

  it('parses E7 4200 Cedar Lane Area format (with spaces in area)', () => {
    const cmd = parseSellerQuote('E7 4200 Cedar Lane Area', 'ellis')
    expect(cmd).toEqual({
      kind: 'offer',
      by: 'ellis',
      requestCode: 'E7',
      priceCents: 420000,
      pickupArea: 'Cedar Lane Area',
    })
  })

  it('rejects invalid price', () => {
    expect(parseSellerQuote('E7 ABC Cedar Lane', 'ellis')).toBeNull()
  })

  it('rejects invalid code', () => {
    expect(parseSellerQuote('F7 4200 Cedar Lane', 'ellis')).toBeNull()
  })
})
