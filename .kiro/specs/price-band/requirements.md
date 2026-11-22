# Price Band requirements

Add a fair-price line to private offer messages so a buyer can see what trades have recently cleared in their circle.

## Requirements

1. Expose a pure function `priceBand(state: MarketState, item: Item, circleId: string, now: Date)` in `src/domain/price-band.ts`. It takes only data already held in `MarketState` and no IO.

2. The function uses only collected exchanges: holds whose state is `'collected'` and whose `collectedAt` timestamp is recorded in `MarketState.priceHistory`. Expired holds, proposed offers and live holds are excluded.

3. The function matches on item `name`, `grade` and `unit` together and on the `circleId` of the original requester. Trades from other circles or other items do not affect the result.

4. Only trades with a `collectedAt` within the last 24 hours of market time (i.e. `collectedAt >= now − 24 h`) are included. A trade 25 or more hours old is excluded.

5. When the filtered trade set has fewer than 3 entries the function returns `null`. Returning `null` suppresses the price-hint line entirely.

6. When the filtered set has 3 or more entries the function returns `{ lowKobo: number; highKobo: number; trades: number }` where `lowKobo` is the 25th-percentile price and `highKobo` is the 75th-percentile price computed by the nearest-rank method (no interpolation). `trades` is the count of entries used.

7. `MarketState` gains a `priceHistory` array of `PriceRecord` entries. `evolve` appends one `PriceRecord` for each `request_collected` event, using the event's `at` field as `collectedAt`. The entry records the item, the circle of the original requester and the `priceKobo` from the accepted offer. This makes the type replay-compatible: folding `evolve` over the event log from empty always reproduces the same `priceHistory`.

8. `decide`'s `offer` and `offer_revised` paths call `priceBand` and, when the result is non-null, append one line to the `offer_received` message: `"Usual today: X,XXX-X,XXX (N trades)"` where amounts are integer credits (kobo ÷ 100, comma-grouped). The hint line is added only to the **private** `offer_received` message sent to the requester. It is never added to `seller_invited`, `request_routed_seller` or any other circle-wide template (I8).

9. Every rendered `offer_received` message, with or without the hint line, must fit within 160 GSM-7 septets. The template lint check must pass.

10. The demo seed in `src/http/server.ts` records five fictional completed egg prices in the local circle before the first interactive message. Dedicated seed events feed only the price history. They do not create open requests or alter trader reliability.
