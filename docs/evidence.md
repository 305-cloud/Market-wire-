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

## Review fixes, 22 November

Kiro was still at its monthly limit. On the owner's instruction, Claude reviewed revision `a552eb3`, then fixed what it found. Kiro did not write these changes. Each change has a regression test in `review/claude-fixes.test.mjs`.

1. **Pickup code was sent to the seller.** A seller could text `GIVEN <code>` without the buyer ever turning up. That closed the buyer's hold and added to both traders' counts. The code now goes only to the buyer, and the seller is asked to get it at handover. The original design note asked for both parties to get the code; the note is revised in `.kiro/specs/pickup-code`.
2. **There was no cap on wrong codes.** The code was guessed on try 662 of 900. After five wrong codes on a live hold, `GIVEN` is refused, including the right code. The buyer's `DONE` still works. Each wrong code is a `pickup_code_rejected` event, so the lock survives replay.
3. **The shortage alert repeated at a two-hour clock-bucket edge** (one alert at 15:50 and another at 16:05). It is now limited to one alert per circle and item within 120 minutes of the previous alert.
4. **A bare `DONE` after the seller confirmed got no reply.** It now repeats the receipt (I3). A `DONE` with nothing held gets a plain reply.
5. **A second wrong message in the same simulated minute was silently suppressed.** Reply dedupe keys used the frozen simulator clock. Rejection replies are now keyed to the inbound message id.
6. **Minor:** a repeated `1 E7` after holding now says "you already hold this crate". A leftover real place name was removed from a code comment.

Checks after the fixes: `tsc` 0 errors. Vitest 95/95. Node suites 33/33 (`claude-fixes`, `transport-regressions`, `core-regressions`, `check-report`). Claude's original repros 8/8. PostgreSQL and browser checks were not re-run in this pass.

## Agent review round, 22 November

Claude ran three independent review agents against the fixed build, then fixed what they found. Kiro did not write these changes. Each has a regression test in `review/claude-fixes.test.mjs` (27 tests).

- **Stress test:** 1,840 random command sequences (109,600 steps), plus about 3,400 targeted attack commands. There were no 5xx errors and no violations of I1–I4, I6–I8 or I10. It confirmed 16 bugs, all fixed:
  - a second word was taken as a request code ("done o", "Done thanks", "CANCEL PLS");
  - repeated STOP, START and DONE replies were silent;
  - 24-hour times and "before 1am" late at night failed;
  - free text, zero, huge and unknown-item requests were accepted;
  - a route that invited nobody blocked any later route;
  - the coordinator could create requests (I5);
  - reply prompts promised commands that then failed;
  - "closed" was shown for open requests;
  - one trader could hold unlimited open requests (now 3);
  - non-GSM text was counted as GSM;
  - the stale-quote reply was unreachable;
  - an early "no offer" warning arrived a minute after a request was made;
  - a confusing message went to the seller who lost;
  - a stranger could learn a request's state;
  - "STOP." and "Stop please" were not honoured;
  - the internal unit "bottle50" was shown to traders.
- **First-use (consumer) review:** fixed the following:
  - shortcut buttons send in one click;
  - every text gets a plain, role-specific reply;
  - a seller hears that their offer went out;
  - WIDEN is confirmed to the buyer;
  - offers say "1 crate for N credits";
  - "4,300" and "N4200" prices work;
  - a number before the price is no longer read as the price;
  - with two open requests, offers say "Reply 1 E8";
  - one crate per request is stated plainly;
  - "tray" means crate;
  - PAUSE and RESUME work;
  - the hold-expiry message no longer blames the buyer.
- **Judge review:** fixed the following:
  - `steering/structure.md` now matches the code;
  - "V2" is dropped;
  - the pickup-code and shortage notes are revised;
  - this log names every author.

  The judge also flagged items that are still open: video, public URL, hooks, the recorded agent attack and Kiro CLI in CI.

The fuzzer was rerun on the fixed build (seeds 777, 4242 and 9001). It found no invariant violations and no silent replies. Short offers whose place names use non-Latin letters go out as a single Unicode SMS of 70 characters or fewer.

Checks: `tsc` 0 errors. Vitest 95/95. Node suites 52/52. Claude's original repros 8/8. API smoke and MCP smoke passed. A browser run of E7 completed in three clicks with no console errors. PostgreSQL tests were not re-run in this pass.

Codex review tests changed to fit the 3-open-request cap: the shortage cases in `transport-regressions` and `mcp-smoke` now spread their asks across two traders.

## Operations room, word reader and rules on the wire, 22 November

Author: Claude (Opus), with the word list generated by a Claude Haiku subagent. Kiro was out of credits, so none of this was written in Kiro.

- **Operations room** (`web/`): a redesign of the coordinator panel, after Cybersyn's 1972 opsroom.
  - Shared requests and shortage signals print as telex slips. Expired and cancelled requests turn into ghost slips. Routed and filled requests are stamped.
  - An alarm lamp lights from `/shortages`.
  - A live network map shows texts pulsing between the traders, the wire and the coordinator desk, with what each trader is doing. An arc lights when a request is routed to the North circle.
  - Reduced motion is respected and the layout was checked at 1440 px and 375 px.
- **Word reader** (`src/parser/lexicon.ts`, `lexicon-data.ts`): rule-based, with no model and no network.
  - It uses 1,194 messy words and phrases (typos, short forms, Nigerian Pidgin such as "abeg" and "i don collect", and time words such as "b4 6"), longest-phrase matching, and a small typo fallback.
  - Clear texts run as the canonical command.
  - For unclear ones the trader is asked "Did you mean: … Reply YES". YES sends it, and any other text drops the suggestion.
  - Canonical commands and seller quotes are never touched.
- **Rules on the wire** (`src/http/rules-audit.ts`, `GET /api/demo/markets/:id/rules`, operations-room panel):
  - Every outbound batch is checked against invariants I1–I8 and I10 as it leaves.
  - Each report re-checks the current state and replays the event log through the same save-and-restore path a restart uses (I7).
  - Each rule is shown in plain words. A broken rule turns red.
  - The route needs the market's bearer token.

Tests: 5 new tests in `review/claude-fixes.test.mjs`:
- the reader runs clear texts;
- "Did you mean" then YES;
- stale suggestions are dropped;
- canonical texts are untouched;
- all rules hold through a full flow, and the route needs the token;
- a forced replay mismatch shows I7 broken.

Checks: `tsc` 0 errors. Vitest 95/95. Node suites 57/57; the PostgreSQL race test needs a database and was not run. Claude's repros 8/8. API smoke and MCP smoke passed.

## Consumer review, round 2, 22 November

Author: Claude. A first-use agent tested the new build as a busy trader typing quickly, with typos, short forms and pidgin.

**What it found:**
- **Three unsafe readings.** Everyday words could trigger real actions:
  - "egg don finish" (sold out) closed a held deal;
  - "my shop dey open" was read as STOP;
  - "hold 1" was read as PAUSE.
- **Generic replies.** Texts with one piece missing got the general help text instead of a hint about what was missing.

**Fixed:**
- **Reader safety rule.** A reading for DONE, CANCEL, WIDEN, STOP, PAUSE, START, RESUME or GIVEN never runs without a YES. The question names the request, e.g. "Did you mean: DONE E7?".
  - Everyday words that misfired were dropped: "don", "hold", "got", "finish" and others.
  - Typo guesses need 5 or more letters.
  - Polite forms of real commands ("done o", "Stop please") still run directly.
- **STATUS.** "status", "my code" and "wetin dey happen" reply with:
  - each open request;
  - its offers;
  - any hold and the buyer's pickup code.
  
  Sellers see their invites and offers, never the code.
- **Hints.**
  - A missing pickup place: "Add the pickup place: E7 3800 <place>".
  - A seller price without a code: "Is this an offer for E7?".
  - A missing time.
  - An item other than eggs or milk.
  - The seller help example now uses the seller's real request code.
- **Other fixes.**
  - "4.5k" prices work.
  - Milk invites say "bottle", not "crate".
  - The buyer is told when the coordinator routes their request.
  - Plain replies for a seller's DONE, GIVEN on a closed request, and a repeated hold.

**Not changed:** the buyer's own DONE still confirms collection, as designed, because the buyer is the one who received the crate.

**Left for later** (product work): switching or releasing a hold, a seller backing out, a warning before a hold ends, routing by text, and "tomorrow" in times.

**Checks:**
- Node suites 60/60. This round added 3 tests, and the reader test now checks the YES rule.
- Vitest 95/95.
- Repros 8/8.
- API smoke and MCP smoke passed.
