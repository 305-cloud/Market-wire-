# Pickup codes and trader records

Generate a three-digit code at the simulator boundary and include it in the hold event. Show it in the buyer and selected seller inboxes. Require the selected seller and matching code for `GIVEN <code> [E7]`. The existing buyer `DONE` command and seller `GIVEN` both use the same collection decision. A repeated confirmation has the existing collection receipt and creates no new collection event.

Record completed pickups for both parties and expiry misses for the buyer. A trader with fewer than three completions shows as new. Keep both the pickup code and the record out of circle-wide messages (I8). The simulator bearer represents its operator and covers the synthetic event feed. The separate inbox views represent the two traders’ screens.

Verify with `test/domain/trader-features.test.ts` and `review/transport-regressions.test.mjs`.
