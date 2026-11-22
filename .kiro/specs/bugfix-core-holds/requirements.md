# Bugfix spec: core hold correctness

Four bugs found during first review of `src/domain/decide.ts` and confirmed by three failing regression tests in `review/core-regressions.test.mjs`. The test fixture in `test/domain/decide.test.ts` also carries a wrong constant that made one passing test misleading. All fixes are confined to `decide.ts` and `decide.test.ts`. No shared domain interfaces (`types.ts`, `events.ts`, `commands.ts`) are changed.

## Requirements

1. A seller's held crate is allocated stock. `decideOffer` must refuse a new offer for the same seller, item, grade and unit combination while any crate owned by that seller for that item is in the `held` state. Minting a second crate ID for physically the same stock is forbidden; it allows two independent holds on one crate and breaks the one-hold-per-crate invariant. The refusal reason is `taken`.

2. `decideCollect` must check the live hold's deadline before mutating state. If `now >= hold.heldUntil` the collect is rejected with reason `closed` even if the scheduler has not yet run a tick. The same wall-clock check applies to any mutation that depends on a live hold still being valid.

3. `decideTick` must send a `fallback_buyer` message for widened requests that have no confirmed pickup at the 30-minute threshold, exactly as it does for `open_local` requests. The guard `req.state !== 'widened'` that blocks widened requests from reaching the fallback path must be removed. Additionally, the fallback must fire even when proposed (but unaccepted) offers exist — having an offer sitting in `proposed` state does not constitute a confirmed pickup. The `hasProposedOffer` suppression block must be removed.

4. The `R_fallback_once` test fixture in `test/domain/decide.test.ts` checks that no fallback fires at 29 minutes before cutoff. The product threshold is 30 minutes. 29 minutes is inside the threshold, so the test currently asserts the wrong outcome and passes only by accident. Move `beforeThreshold` to 31 minutes before cutoff (outside the threshold) so the test correctly verifies that the fallback has not yet fired at that point. Do not change the product threshold.
