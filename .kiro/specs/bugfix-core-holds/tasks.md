# Tasks

- [x] Write requirements, design and tasks files in `.kiro/specs/bugfix-core-holds/`.
- [x] Fix double allocation: in `decideOffer`, add a held-crate guard that returns `taken` when the seller already holds a crate for the same item/grade/unit (`src/domain/decide.ts`).
- [x] Fix late collection: in `decideCollect`, add `now >= hold.heldUntil` check and return `closed` when the hold has expired (`src/domain/decide.ts`).
- [x] Fix widened fallback: in `decideTick`, remove the `req.state !== 'widened'` guard and remove the `hasProposedOffer` suppression block (`src/domain/decide.ts`).
- [x] Fix test fixture: in `R_fallback_once`, change `beforeThreshold` from `CUTOFF - 29 minutes` to `CUTOFF - 31 minutes` (`test/domain/decide.test.ts`).
- [x] Confirm that `src/domain/types.ts` and `src/domain/events.ts` are unchanged.
