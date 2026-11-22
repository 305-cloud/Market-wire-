// src/parser/rule-interpreter.ts
// Rule-based interpreter that translates parsed commands into decisions.
// Uses decide() from domain layer and validates against invariants.

import type { MarketState } from '../domain/types.js'
import type { Command as DomainCommand } from '../domain/commands.js'
import type { DomainEvent } from '../domain/events.js'
import { decide } from '../domain/decide.js'
import { checkInvariants } from '../domain/invariants.js'
import { evolve } from '../domain/evolve.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Interpret a domain command against the current state.
 * Returns either:
 * - { ok: true, events, outbound, nextState } for success
 * - { ok: false, reason, outbound } for rejection
 */
export function interpretCommand(cmd: DomainCommand, state: MarketState, now: Date): InterpretResult {
  const decision = decide(state, cmd, now)

  if (decision.ok) {
    // Validate invariants
    const violations = checkInvariants(state, decision.outbound)
    if (violations.length > 0) {
      return {
        ok: false,
        reason: 'invariant_violation',
        outbound: [],
        violations,
      }
    }

    // Compute next state
    const nextState = decision.events.reduce(
      (s, ev) => evolve(s, ev),
      state,
    )

    return {
      ok: true,
      events: decision.events,
      outbound: decision.outbound,
      nextState,
    }
  }

  return {
    ok: false,
    reason: decision.reason,
    outbound: decision.outbound,
  }
}



// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface InterpretResult {
  ok: boolean
  reason?: string
  outbound: any[]
  events?: DomainEvent[]
  nextState?: MarketState
  violations?: { invariant: string; detail: string }[]
}