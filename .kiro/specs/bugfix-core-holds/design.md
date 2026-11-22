# Design

All changes are inside the pure decision function in `src/domain/decide.ts`. The domain model in `types.ts` and `events.ts` already has everything required: `CrateState` includes `'held'`, `HoldRecord` has `heldUntil`, and `RequestRecord` carries `fallbackSentAt`. No new events, types or interfaces are needed.

## Bug A — double allocation (`decideOffer`)

The existing crate lookup filters on `c.state === 'available'`. When a crate is in state `'held'` the lookup misses it and falls through to `randomUUID()`, minting a second phantom crate for the same physical stock.

The fix adds a second lookup before the new-offer path: search all crates owned by the seller for the same item/grade where `state === 'held'`. If any such crate is found the function returns `{ ok: false, reason: 'taken' }`. This check runs after the per-request duplicate-offer check (which covers the revision path) and before the crate-ID assignment.

## Bug B — late collection (`decideCollect`)

The function reaches the `request_collected` event without checking whether the live hold's deadline has passed. The hold's `heldUntil` field equals `req.cutoffAt`, so a single check `now >= hold.heldUntil` suffices. The check is inserted immediately after the hold is retrieved and before any events are pushed, returning `{ ok: false, reason: 'closed' }` on failure.

## Bug C — widened fallback (`decideTick`)

Two independent problems prevent widened requests from receiving the fallback.

First, the condition `req.state !== 'widened'` on the fallback block skips widened requests entirely. Removing this condition allows widened requests to reach the fallback path under the same threshold and `fallbackSentAt` guard.

Second, within the fallback block, a `hasProposedOffer` check suppresses the message whenever any offer exists in `proposed` state. A proposed offer is not a confirmed pickup. The buyer needs the fallback signal regardless of whether sellers have responded but the buyer has not yet accepted. The entire `hasProposedOffer` guard and its wrapping `if` are removed; the threshold and `fallbackSentAt` guard are sufficient gatekeeping.

## Bug D — wrong test fixture (`decide.test.ts`)

`R_fallback_once` uses `CUTOFF - 29 minutes` as `beforeThreshold`, then asserts zero fallbacks at that moment. Because 29 < 30 the threshold has already been crossed, so the assert passes only because the state includes no `fallbackSentAt` from a prior tick — not because the threshold has not been reached. Setting `beforeThreshold` to `CUTOFF - 31 minutes` places the check genuinely outside the 30-minute window and makes the assertion meaningful.
