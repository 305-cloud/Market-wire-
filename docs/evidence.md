# Market Wire build evidence

## 21 November 2026

Kiro CLI 3.5.0 generated the initial TypeScript scaffold, domain and example tests in a local authenticated session. Codex reviewed the generated code and executed the checks. The initial build compiled. Vitest reported 9 passes and 1 failure. The failing fallback fixture used 29 minutes before closing as a point before the 30-minute threshold. The correct fixture uses 31 minutes.

Three independently written checks in `review/core-regressions.test.mjs` failed against the first compiled core:

1. A second offer while the same seller's crate was held could mint another crate ID and produce a second valid hold.
2. A DONE arriving after the deadline but before the scheduler tick could collect an expired hold.
3. A widened request with an offer and no confirmed pickup received no fallback at the threshold.

A separate Kiro CLI session wrote [.kiro/specs/bugfix-core-holds](../.kiro/specs/bugfix-core-holds) from those observed failures and edited the core and fixture. The independent rerun after the edits passed 3/3 and Vitest passed 10/10. Reproduce with `npm run build`, `node --test review/core-regressions.test.mjs` and `npm test`.

The runtime npm audit initially reported three high advisories. After updating the direct dependencies reported by the audit, `npm audit --omit=dev --audit-level=high` reported zero vulnerabilities.

## Local review build

- TypeScript compiled and the compiled server served the local browser console and API.
- Vitest passed 57 tests. The independent core suite passed all four checks, including 2,500 seeded reservation and event replay sequences. The QA report checker passed three tests.
- Real PostgreSQL 16.16 accepted the migration. The standalone event repository passed a two-buyer reservation race and replayed the winner after reconnecting. The HTTP simulator uses PostgreSQL session snapshots through a separate path. Its full service restart test preserved the authenticated session, hold and simulated clock.
- The HTTP smoke completed E7 and E8, checked duplicate receipts and market isolation, rotated one token on reset, exercised fallback and expiry, and rejected old quote replies after a price change.
- The stdio MCP smoke exercised discovery, session creation, private authentication, sending, duplicate replay, state and clock advancement.
- Chrome at 1440px and 375px completed both stories. The verification checked keyboard focus, horizontal overflow, the buyer's hold and widening shortcuts, clock advancement and the reset button.

This artifact is for local bug review. It uses fictional traders and simulated messages. Live SMS, field testing, public hosting and a recorded Kiro persona attack remain outside this verified build. The CI workflow is included for future execution. The browser smoke uses a separate installed Chrome test runtime.

## Location-neutral demo update

The simulator uses fictional trader names and pickup locations, generic credits and a fixed market clock. The API smoke verifies the starting time, quote currency and absence of previous location labels in the seeded state. Both stories, expiration, reset, stale-price handling and the MCP smoke passed after the change. Vitest passed 57 tests.

## 22 November 2026 review

Claude's independent suite first found eight failures on `f165292`. After Kiro handled the quote and transport changes, the original suite passed all eight cases. The expanded regression suite covers named cancellation, seller notification at hold expiry, authorization and body size limits. Run it with `npm run build` and `node --test review/transport-regressions.test.mjs`.

- [Quote integrity](../.kiro/specs/bugfix-quote-integrity) covers quote numbers, price units and repeat offers in the same request.
- [Demo transport](../.kiro/specs/bugfix-demo-transport) covers inbox replies, explicit command targets, authenticated history and session limits.
- The simulator returns HTTP 400 for a rejected command while adding a reply to the trader's inbox. It preserves the browser and MCP error signal. Live provider acknowledgement will need its own transport contract.
- Browser tests ran both pickup flows in desktop and mobile Chrome. The API and MCP exercised the event feed, and the PostgreSQL restart smoke exercised snapshot recovery.
- Invalid aliases leave the delivery ID usable. The simulator suppresses retried side effects and keeps its existing duplicate status. Exact transport-response replay remains a gateway integration item.

## Trader feature and consumer follow-up

Kiro wrote the market core, the bugfix revision `f3d95bc`, and the first price-band spec and implementation. Kiro CLI reported its monthly usage limit during that work. On the owner's instruction, Codex completed the price band and implemented the shortage alerts, pickup codes, reliability counts and browser fixes. The feature specs in this revision describe those changes. They do not imply that Kiro wrote the follow-up code.

- Tests passed in the local simulator. Vitest ran 95 tests and Node ran the original eight Claude repros, the transport suite, 2,500 seeded core races and the acceptance-report checker. The transport check produced exactly one coordinator alert for five unmet requests and verified that both authorized pickup commands produced only one collection event.
- Chrome at 1440px and 375px verified local and widened pickups, quote labels that identify seller and price, pickup-code visibility in the matching seller view, reloading the same market, advancing the clock and confirming or cancelling a reset.
- The stdio MCP check exercised the shortage tool and its alert event. A local PostgreSQL restart preserved the hold, its pickup code and the simulated clock. A distinct PostgreSQL test ran the repository two-buyer race.
- The three panes represent the separate buyer and seller phones and the coordinator desk. Quote labels carry decision information. The reset dialog protects visitor progress. Existing dispatch typography, paint and spacing keep attention on the texts and route action.

This is a local review build with simulated trades and messages. The room does not render private texts. The simulator operator can deliberately inspect the full synthetic log and switch roles. Public deployment, real provider replay and field testing are outside this verification.
