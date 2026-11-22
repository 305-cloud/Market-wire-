// test/parser/pm-hour-bugfix.test.ts
// Regression tests for the bare 8/9 PM disambiguation fix.
//
// Before this fix, `NEED 1 CRATE EGGS BEFORE 8` sent at 14:00 UTC produced a
// cutoff of 08:00 (already past). After the fix, bare 8 and 9 sent at or after
// 12:00 UTC resolve to 20:00 and 21:00 respectively.
//
// Covers:
//  - disambiguateHour() pure function: all table cases from the spec
//  - parseCreateRequest(): cutoff dates for the bug case and preserved behaviours

import { describe, it, expect } from 'vitest'
import { disambiguateHour, parseCreateRequest } from '../../src/parser/interpret.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a UTC Date from a date-time string (must include "Z"). */
function utc(iso: string): Date {
  return new Date(iso)
}

/** Extract the ISO string of the cutoffAt from a parseCreateRequest result. */
function cutoffOf(result: ReturnType<typeof parseCreateRequest>): string {
  if (!result || result.kind !== 'create_request') throw new Error('unexpected null/kind')
  return result.cutoffAt.toISOString()
}

// ---------------------------------------------------------------------------
// disambiguateHour – pure function
// ---------------------------------------------------------------------------

describe('disambiguateHour', () => {
  // Bug cases: bare 8 and 9 sent after midday

  it('bare 8 sent after midday → 20', () => {
    expect(disambiguateHour(8, utc('2026-11-21T14:00:00Z'))).toBe(20)
  })

  it('bare 9 sent after midday → 21', () => {
    expect(disambiguateHour(9, utc('2026-11-21T14:00:00Z'))).toBe(21)
  })

  it('bare 8 sent exactly at 12:00 UTC → 20 (boundary: at noon is "at or after")', () => {
    expect(disambiguateHour(8, utc('2026-11-21T12:00:00Z'))).toBe(20)
  })

  it('bare 9 sent exactly at 12:00 UTC → 21', () => {
    expect(disambiguateHour(9, utc('2026-11-21T12:00:00Z'))).toBe(21)
  })

  // Before midday: morning is still ahead, so keep as-is

  it('bare 8 sent before midday → 8', () => {
    expect(disambiguateHour(8, utc('2026-11-21T09:00:00Z'))).toBe(8)
  })

  it('bare 9 sent before midday → 9', () => {
    expect(disambiguateHour(9, utc('2026-11-21T09:00:00Z'))).toBe(9)
  })

  it('bare 8 at 11:59 UTC → 8 (just before boundary)', () => {
    expect(disambiguateHour(8, utc('2026-11-21T11:59:00Z'))).toBe(8)
  })

  // Hours 1–7: always afternoon regardless of clock

  it('bare 6 after midday → 18', () => {
    expect(disambiguateHour(6, utc('2026-11-21T14:00:00Z'))).toBe(18)
  })

  it('bare 1 after midday → 13', () => {
    expect(disambiguateHour(1, utc('2026-11-21T14:00:00Z'))).toBe(13)
  })

  it('bare 7 after midday → 19', () => {
    expect(disambiguateHour(7, utc('2026-11-21T14:00:00Z'))).toBe(19)
  })

  it('bare 6 before midday → 18 (1–7 rule is not clock-dependent)', () => {
    expect(disambiguateHour(6, utc('2026-11-21T09:00:00Z'))).toBe(18)
  })

  // Hours 10–12: always morning regardless of clock

  it('bare 10 after midday → 10', () => {
    expect(disambiguateHour(10, utc('2026-11-21T14:00:00Z'))).toBe(10)
  })

  it('bare 11 after midday → 11', () => {
    expect(disambiguateHour(11, utc('2026-11-21T14:00:00Z'))).toBe(11)
  })

  it('bare 12 after midday → 12', () => {
    expect(disambiguateHour(12, utc('2026-11-21T14:00:00Z'))).toBe(12)
  })
})

// ---------------------------------------------------------------------------
// parseCreateRequest – cutoff resolution
// ---------------------------------------------------------------------------

describe('parseCreateRequest cutoff time', () => {
  // ---- Bug cases -----------------------------------------------------------

  it('bare 8 at 14:00 UTC → cutoff 20:00 same day', () => {
    const now = utc('2026-11-21T14:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 8', 'mara', now)))
      .toBe('2026-11-21T20:00:00.000Z')
  })

  it('bare 9 at 14:00 UTC → cutoff 21:00 same day', () => {
    const now = utc('2026-11-21T14:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 9', 'mara', now)))
      .toBe('2026-11-21T21:00:00.000Z')
  })

  it('bare 8 at 12:00 UTC (noon) → cutoff 20:00 same day', () => {
    const now = utc('2026-11-21T12:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 8', 'mara', now)))
      .toBe('2026-11-21T20:00:00.000Z')
  })

  // ---- Morning: 8 and 9 still ahead ----------------------------------------

  it('bare 8 at 09:00 UTC → cutoff 08:00 (elapsed → next day)', () => {
    // 08:00 is before 09:00, so roll forward to tomorrow
    const now = utc('2026-11-21T09:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 8', 'mara', now)))
      .toBe('2026-11-22T08:00:00.000Z')
  })

  it('bare 9 at 09:00 UTC → cutoff 09:00 same day (exactly now → elapsed → next day)', () => {
    // 09:00 is not strictly after now (09:00 <= 09:00), so it also rolls to tomorrow
    const now = utc('2026-11-21T09:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 9', 'mara', now)))
      .toBe('2026-11-22T09:00:00.000Z')
  })

  it('bare 9 at 08:30 UTC → cutoff 09:00 same day (ahead)', () => {
    const now = utc('2026-11-21T08:30:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 9', 'mara', now)))
      .toBe('2026-11-21T09:00:00.000Z')
  })

  // ---- Explicit am/pm: clock is ignored ------------------------------------

  it('explicit 8am at 14:00 UTC → cutoff 08:00 next day (elapsed)', () => {
    const now = utc('2026-11-21T14:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 8am', 'mara', now)))
      .toBe('2026-11-22T08:00:00.000Z')
  })

  it('explicit 8pm at 14:00 UTC → cutoff 20:00 same day', () => {
    const now = utc('2026-11-21T14:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 8pm', 'mara', now)))
      .toBe('2026-11-21T20:00:00.000Z')
  })

  it('explicit 8am at 06:00 UTC → cutoff 08:00 same day', () => {
    const now = utc('2026-11-21T06:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 8am', 'mara', now)))
      .toBe('2026-11-21T08:00:00.000Z')
  })

  // ---- Preserved behaviour: hours 1–7 unaffected by clock -----------------

  it('bare 6 at 14:00 UTC → cutoff 18:00 same day', () => {
    const now = utc('2026-11-21T14:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 6', 'mara', now)))
      .toBe('2026-11-21T18:00:00.000Z')
  })

  it('bare 6 at 09:00 UTC → cutoff 18:00 same day (rule unchanged)', () => {
    const now = utc('2026-11-21T09:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 6', 'mara', now)))
      .toBe('2026-11-21T18:00:00.000Z')
  })

  it('bare 7 at 14:00 UTC → cutoff 19:00 same day', () => {
    const now = utc('2026-11-21T14:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 7', 'mara', now)))
      .toBe('2026-11-21T19:00:00.000Z')
  })

  // ---- Preserved behaviour: hours 10–12 unaffected by clock ---------------

  it('bare 12 at 09:00 UTC → cutoff 12:00 same day', () => {
    const now = utc('2026-11-21T09:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 12', 'mara', now)))
      .toBe('2026-11-21T12:00:00.000Z')
  })

  it('bare 10 at 14:00 UTC → cutoff 10:00 next day (elapsed)', () => {
    const now = utc('2026-11-21T14:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 10', 'mara', now)))
      .toBe('2026-11-22T10:00:00.000Z')
  })

  it('bare 11 at 09:00 UTC → cutoff 11:00 same day', () => {
    const now = utc('2026-11-21T09:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 11', 'mara', now)))
      .toBe('2026-11-21T11:00:00.000Z')
  })

  // ---- Minutes preserved ---------------------------------------------------

  it('bare 8:30 at 14:00 UTC → cutoff 20:30 same day', () => {
    const now = utc('2026-11-21T14:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 8:30', 'mara', now)))
      .toBe('2026-11-21T20:30:00.000Z')
  })

  it('explicit 6pm at 14:00 UTC → cutoff 18:00 same day', () => {
    const now = utc('2026-11-21T14:00:00Z')
    expect(cutoffOf(parseCreateRequest('NEED 1 CRATE EGGS BEFORE 6pm', 'mara', now)))
      .toBe('2026-11-21T18:00:00.000Z')
  })

  // ---- Case-insensitive input ----------------------------------------------

  it('lowercase "before 8" at 14:00 UTC → cutoff 20:00', () => {
    const now = utc('2026-11-21T14:00:00Z')
    expect(cutoffOf(parseCreateRequest('need 1 crate eggs before 8', 'mara', now)))
      .toBe('2026-11-21T20:00:00.000Z')
  })

  // ---- Invalid inputs still return null ------------------------------------

  it('returns null when no BEFORE/BY keyword', () => {
    const now = utc('2026-11-21T14:00:00Z')
    expect(parseCreateRequest('NEED 1 CRATE EGGS', 'mara', now)).toBeNull()
  })

  it('returns null when no quantity', () => {
    const now = utc('2026-11-21T14:00:00Z')
    expect(parseCreateRequest('EGGS BEFORE 8', 'mara', now)).toBeNull()
  })
})
