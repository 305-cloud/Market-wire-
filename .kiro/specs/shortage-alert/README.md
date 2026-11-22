# Aggregate shortage alerts

On a tick, group requests in the previous 120 minutes by item and original circle. At five or more asks and a fill rate below half, send the coordinator one aggregate alert per circle, item and two-hour bucket. Persist the alert as an event to deduplicate on replay. Keep case dispatch behind buyer consent (I5). Share only the item, circle and counts (I10).

The authenticated simulator shortages route serves the same aggregate through `market_shortages`. See `review/transport-regressions.test.mjs` and `review/mcp-smoke.mjs` for threshold, deduplication, and event checks.
