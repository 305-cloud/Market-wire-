# Price Band tasks

- [x] Add `PriceRecord` interface and `priceHistory: PriceRecord[]` field to `MarketState` in `src/domain/types.ts`. Initialise it to `[]` in `emptyMarketState`.
- [x] Update `evolve` in `src/domain/evolve.ts` to handle `request_collected` by appending a `PriceRecord` to `priceHistory`. Derive `item` from the request, `circleId` from the requester's trader record, `priceCents` from the accepted offer, and `collectedAt` from the event's `at` field.
- [x] Create `src/domain/price-band.ts` with the `priceBand` function using nearest-rank 25th/75th percentiles. Return `null` for fewer than 3 trades.
- [x] Update `src/messages/templates.ts`: add optional `bandLine` variable to `offer_received`. When present, append it after a newline. Keep the template within 160 GSM-7 septets for the longest sample values.
- [x] Update `decide`'s `decideOffer` function in `src/domain/decide.ts`: call `priceBand` using the request's `item` and the requester's `circleId`, then set `bandLine` on the `offer_received` intent when the result is non-null. Apply the same change to the revised-offer path.
- [x] Seed 5 fictional completed eggs trades before opening the interactive request.
- [x] Verify the price window and minimum for matching grades and circles in `test/domain/trader-features.test.ts`.
- [x] Generate varying private details and check that circle-wide templates omit them.
- [x] Exclude trades after the evaluation clock and cover both window boundaries.
- [x] Keep the quote and reply instructions when the optional data would exceed the SMS budget.
- [x] Rerun the original regressions and observe the band in a new E7 simulator offer.
