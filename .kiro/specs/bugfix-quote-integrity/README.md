# Bugfix Spec: Quote Integrity

## Bugs Fixed

| # | Bug | File | Line | Fix |
|---|---|---|---|---|
| 1 | Stale check compares against any offer | `resolve-target.ts` | 79-88 | Compare only against same offer's own revision |
| 2 | Price shown as 1/100 of typed | `interpret.ts` | 191-194 | Parse typed as whole units (×100), reject 0/absurd |
| 5 | Reply ref reused for different seller | `decide.ts` | 221-226 | Number refs from ALL offers ever on request |
| D | Seller not notified on expiry | `decide.ts` | 722-741 | Add seller notification on hold expiry |

## Regression Tests

Tests live in: `.build-input/repro.test.mjs`

### Bug 1: Stale check against same offer only
- Ellis offers (ref 1, rev 1)
- Jules offers (ref 2) and revises once
- Mara sends "1" → should succeed (Ellis's offer not revised)

### Bug 2: Credit parsing
- Type "4200" → parses to 420000 kobo
- Type "0" → rejects
- Type "10000001" → rejects (exceeds 1M cap)

### Bug 5: Never reuse refs
- Ellis offers E7 (ref 1), E8 (ref 1), Jules holds E8
- Ellis's E7 released, Jules offers E7 → gets ref 2, not ref 1

### Bug D: Seller notification on expiry
- Hold expires → buyer AND seller both receive expiry message