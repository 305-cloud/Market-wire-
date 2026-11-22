# Pickup codes and trader records

Generate a three-digit code at the simulator boundary and include it in the hold event. Show it **only in the buyer's inbox** (revised 22 Nov: sending it to the seller let a seller confirm a pickup the buyer never made). The seller's hold message asks them to get the code from the buyer at handover. Require the selected seller and matching code for `GIVEN <code> [E7]`. After five wrong codes on a live hold, refuse every further `GIVEN` for that hold (including the right code) and tell the seller to ask the buyer to reply `DONE`; record each wrong code as a `pickup_code_rejected` event so the lock survives replay (I7). The existing buyer `DONE` command and seller `GIVEN` both use the same collection decision. A repeated confirmation has the existing collection receipt and creates no new collection event.

Record completed pickups for both parties and expiry misses for the buyer. A trader with fewer than three completions shows as new. Keep both the pickup code and the record out of circle-wide messages (I8). The simulator bearer represents its operator and covers the synthetic event feed. The separate inbox views represent the two traders’ screens.

A bare `DONE` from a buyer whose request the seller already confirmed repeats the same receipt (I3); a `DONE` with nothing held gets one plain reply.

Verify with `test/domain/trader-features.test.ts`, `review/transport-regressions.test.mjs` and `review/claude-fixes.test.mjs`.
