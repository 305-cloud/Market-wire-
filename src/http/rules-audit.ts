// src/http/rules-audit.ts
// "Rules on the wire" (22 Nov 2026, Claude). Every batch of outbound texts is checked against the
// market invariants as it leaves, and each report re-checks the current state and replays the
// event log through a save-and-restore round trip (I7). The operations room shows the result.

import type { MarketState } from '../domain/types.js'
import type { DomainEvent } from '../domain/events.js'
import type { OutboundIntent } from '../domain/decide.js'
import { checkInvariants, type InvariantId, type Violation } from '../domain/invariants.js'

export const RULES: ReadonlyArray<{ id: InvariantId; text: string }> = [
  { id: 'I1', text: 'Each item of stock is held for one buyer at a time' },
  { id: 'I2', text: 'A request holds one item at a time' },
  { id: 'I3', text: 'A request is collected once' },
  { id: 'I4', text: 'Paused sellers get no invites' },
  { id: 'I5', text: 'The coordinator sees a request only after its buyer shares it' },
  { id: 'I6', text: 'A closed request stays closed' },
  { id: 'I7', text: 'Replaying the log rebuilds the same market' },
  { id: 'I8', text: 'Invites carry no price or phone number' },
  { id: 'I10', text: 'Shortage alerts carry counts, never names' },
]

interface Audit { checks: number; violations: Violation[] }
const audits = new WeakMap<object, Audit>()

function auditFor(market: object): Audit {
  let audit = audits.get(market)
  if (!audit) { audit = { checks: 0, violations: [] }; audits.set(market, audit) }
  return audit
}

/** Forget the audit when a market is reset. */
export function resetAudit(market: object): void { audits.delete(market) }

/** Check one batch of outbound texts against the state they were decided on. */
export function auditOutbound(market: object, state: MarketState, outbound: OutboundIntent[]): void {
  if (!outbound.length) return
  const audit = auditFor(market)
  audit.checks++
  for (const v of checkInvariants(state, outbound, 'demo')) {
    if (audit.violations.length < 50) audit.violations.push(v)
  }
}

/** Stable text form of a market state (Maps and Sets in insertion order, Dates as ISO). */
export function fingerprint(state: MarketState): string {
  return JSON.stringify(state, (_key, value: unknown) =>
    value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value] : value)
}

export interface RulesReport {
  checks: number
  events: number
  rules: Array<{ id: InvariantId; text: string; holding: boolean }>
  broken: number
}

/**
 * Build the report. `build` replays an event list into a state; `revive` restores one stored event
 * (the same function a restart uses), so I7 fails if saving and restoring would change the market.
 */
export function rulesReport(
  market: { events: DomainEvent[] },
  build: (events: DomainEvent[]) => MarketState,
  revive: (event: DomainEvent) => DomainEvent,
): RulesReport {
  const audit = auditFor(market)
  const live = build(market.events)
  const restored = build((JSON.parse(JSON.stringify(market.events)) as DomainEvent[]).map(revive))
  const now = checkInvariants(live, [], 'demo')
  if (fingerprint(live) !== fingerprint(restored)) now.push({ invariant: 'I7', detail: 'Replay after restore differs' })
  const broken = new Set<InvariantId>([...audit.violations, ...now].map(v => v.invariant))
  const rules = RULES.map(rule => ({ ...rule, holding: !broken.has(rule.id) }))
  return { checks: audit.checks + 1, events: market.events.length, rules, broken: rules.filter(r => !r.holding).length }
}
