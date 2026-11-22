# Bugfix Spec: Bare 8/9 sent after midday resolves to 20:00/21:00

**File:** `src/parser/interpret.ts`
**Scope:** parser layer only — no changes to `src/http`, steering, or domain.

---

## Problem

A buyer who sends `NEED 1 CRATE EGGS BEFORE 8` after midday expects a 20:00 cutoff.
The current `parseCreateRequest` function uses a fixed rule that treats bare hours
8–12 as morning (08:00–12:00). The function ignores the market clock, so at 14:00
`BEFORE 8` produces a cutoff of 08:00 — a time already in the past.

The HTTP layer in `server.ts` has the same gap: its unqualified-hour branch uses
`hour <= 7 ? hour + 12 : hour`, which also leaves 8 and 9 as morning.

This spec covers the fix that belongs **entirely in `interpret.ts`**.

---

## Root cause

`parseCreateRequest` calls `new Date()` for "now" and contains no logic to infer
afternoon from context when the message carries no `am`/`pm` suffix. Hours 8 and 9
are ambiguous in the morning and unambiguous (must be PM) in the afternoon, but the
function treats them as 08:xx in both cases.

---

## Fix

### 1. Export a pure helper: `disambiguateHour`

```ts
export function disambiguateHour(hour: number, nowAt: Date): number
```

Inputs:
- `hour` — the bare integer hour from the message (1–12).
- `nowAt` — the market clock time at the moment the message is received.

Rules applied in order:

| Condition | Result |
|---|---|
| `hour` is 1–7 | `hour + 12` (afternoon; matches server.ts's existing rule) |
| `hour` is 10–12 | `hour` as-is (morning; unambiguous) |
| `hour` is 8 or 9, `nowAt` is **before** 12:00 UTC | `hour` as-is (morning is still possible) |
| `hour` is 8 or 9, `nowAt` is **at or after** 12:00 UTC | `hour + 12` (08:xx is past; must mean evening) |

"At or after 12:00 UTC" means `nowAt.getUTCHours() >= 12`.

### 2. Update `parseCreateRequest` signature

Add an optional third parameter:

```ts
export function parseCreateRequest(
  message: string,
  senderId: string,
  nowAt?: Date,
): DomainCommand | null
```

Inside the function, replace `new Date()` with `nowAt ?? new Date()` where the
reference time is needed, and replace the existing `isPm ? hour + 12 : hour` hour
calculation with:

```ts
const hour24 = ampm
  ? (ampm === 'pm' ? (hour === 12 ? 12 : hour + 12) : (hour === 12 ? 0 : hour))
  : disambiguateHour(hour, now);
```

The cutoff is then built from `hour24` and `minute` against today's UTC date
derived from `now`.

---

## Behaviour table (regression contract)

| Message | nowAt (UTC) | Expected cutoff (UTC) |
|---|---|---|
| `NEED 1 CRATE EGGS BEFORE 8` | 09:00 | 08:00 same day (morning still ahead) |
| `NEED 1 CRATE EGGS BEFORE 8` | 14:00 | 20:00 same day |
| `NEED 1 CRATE EGGS BEFORE 9` | 14:00 | 21:00 same day |
| `NEED 1 CRATE EGGS BEFORE 8am` | 14:00 | 08:00 next day (explicit am, cutoff elapsed → tomorrow) |
| `NEED 1 CRATE EGGS BEFORE 6` | 14:00 | 18:00 same day (rule: 1–7 → PM, unchanged) |
| `NEED 1 CRATE EGGS BEFORE 12` | 09:00 | 12:00 same day (10–12 → as-is) |
| `NEED 1 CRATE EGGS BEFORE 10` | 14:00 | 10:00 next day (elapsed → tomorrow) |

The "elapsed → tomorrow" roll-forward that already exists in `parseCreateRequest` is
unchanged and applies after `disambiguateHour` resolves the hour.

---

## Out of scope

- `src/http/server.ts` — not modified. Its disambiguation runs after `parseCreateRequest`
  and overwrites the cutoff anyway; a follow-up issue should align it.
- Steering documents.
- Any other parser function.
- LLM interpreter path.

---

## Acceptance criteria

1. `disambiguateHour(8, new Date('2026-11-21T14:00:00Z'))` returns `20`.
2. `disambiguateHour(9, new Date('2026-11-21T14:00:00Z'))` returns `21`.
3. `disambiguateHour(8, new Date('2026-11-21T09:00:00Z'))` returns `8`.
4. `disambiguateHour(6, new Date('2026-11-21T14:00:00Z'))` returns `18`.
5. `disambiguateHour(12, new Date('2026-11-21T14:00:00Z'))` returns `12`.
6. `parseCreateRequest('NEED 1 CRATE EGGS BEFORE 8', 'mara', new Date('2026-11-21T14:00:00Z'))` produces a cutoff of `2026-11-21T20:00:00Z`.
7. `parseCreateRequest('NEED 1 CRATE EGGS BEFORE 8am', 'mara', new Date('2026-11-21T14:00:00Z'))` produces a cutoff of `2026-11-22T08:00:00Z` (explicit am, elapsed → tomorrow).
8. `parseCreateRequest('NEED 1 CRATE EGGS BEFORE 6', 'mara', new Date('2026-11-21T14:00:00Z'))` produces a cutoff of `2026-11-21T18:00:00Z`.
9. All pre-existing tests in `test/parser/` continue to pass.
