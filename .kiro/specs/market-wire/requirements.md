# Market Wire requirements

Market Wire revives Cybersyn's local handling of shortages and escalation by exception. A buyer can find stock by SMS after their usual source sells out. Implement a local demonstration for review, with synthetic traders and a browser that requires no login. The Android gateway is a separately configured pilot.

1. Accept one clearly interpretable request for 30 medium eggs (one crate) before a stated cutoff. Ask a clarifying question if quantity, grade or time matters and is missing. Plain instructions and numbered replies must complete both stories without an AI provider.
2. Invite a bounded set of consenting local sellers. Keep each request, quote and person's identity out of the coordinator's view until the buyer opts into widening. The coordinator may see aggregate counts.
3. Sellers can offer one spare crate and privately quote a total price, pickup area and expiry. The buyer can review those terms and reply 1 for the displayed offer. Share exact directions only after acceptance.
4. Keep an immutable offer code for each quoted revision. A bare SMS 1 may accept only the one unchanged quote ever presented as the current numbered choice in that conversation. If a quote was superseded, multiple choices were presented, or the sender has multiple open exchanges, ask for the current short code. A stale code cannot accept new terms. Browser actions send the visible quote revision.
5. Reserve a physical crate once across requests, atomically. Release alternatives only on accepted terms. A seller may offer a released crate anew. Cancel, expiry or collection are idempotent. Old commands cannot revive offers or inventory.
6. With buyer consent, the coordinator may route one sanitized exception to at most three eligible neighboring sellers. Recheck consent, cutoff, opt-out and delivery state before dispatch. Deduplicate overlapping membership, repeated widening and delivery retries. Keep price and phone numbers out of invitations. The coordinator cannot reserve stock.
7. Offer a fallback to calling while time remains. A late delivery or replay cannot revive a closed request. Isolate market sessions, including their clock, data and reset. A public simulation session cannot send real messages.
8. Ship a replayable simulator-only MCP interface for send, duplicate, advance clock and inspect. Keep live SMS outside its authority. Save genuine Kiro traces and counterexamples when they occur.
9. Keep price ranges, trader records and pickup codes out of circle-wide messages (I8). Shortage alerts contain only item, circle and counts and only trigger at or above the ask threshold (I10).

## Acceptance

Run E7 local pickup, E8 widened pickup, and late replay in signed-out desktop and mobile browsers. Run both flows with the model disabled. Verify persistence across server restarts. Run the machine-readable cases in the QA packet and property tests with recorded seeds.
