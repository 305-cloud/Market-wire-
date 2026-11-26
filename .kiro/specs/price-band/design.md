# Price Band design

## Data model change

Add `PriceRecord` and `priceHistory` to `MarketState`:

```ts
// src/domain/types.ts (addition)
export interface PriceRecord {
  item: Item         // name + grade + unit, copied from the request
  circleId: CircleId // circle of the original requester
  priceCents: number  // from the accepted offer at collection time
  collectedAt: Date  // from the request_collected event's `at` field
}

// MarketState gains:
priceHistory: PriceRecord[]
```

`emptyMarketState` initialises `priceHistory` as `[]`.

`evolve` handles `request_collected` by looking up the request's `item` and `requesterId → circleId`, the hold's `offerId → priceCents`, and appending a `PriceRecord`. Because all of this comes from already-evolved state (the request and offer are in state before the collection event fires), no extra events are needed. Replay is deterministic.

## Percentile calculation (nearest rank)

```
sorted = prices sorted ascending
rank(p) = ceil(p / 100 * n)   where n = sorted.length
p25 = sorted[rank(25) - 1]
p75 = sorted[rank(75) - 1]
```

Edge: `rank(25)` for n=3 is `ceil(0.75) = 1`, so p25 = sorted[0]; `rank(75)` = `ceil(2.25) = 3`, so p75 = sorted[2]. This gives max spread for small samples, which is conservative and informative.

## `priceBand` function

```ts
// src/domain/price-band.ts
export function priceBand(
  state: MarketState,
  item: Item,
  circleId: string,
  now: Date,
): { lowCents: number; highCents: number; trades: number } | null
```

1. Filter `state.priceHistory` to entries where `item.name`, `item.grade` and `item.unit` match and `circleId` matches.
2. Further filter to entries where `collectedAt >= now − 24*60*60*1000 ms`.
3. If fewer than 3 entries remain, return `null`.
4. Sort ascending by `priceCents` and apply the nearest-rank formula.
5. Return `{ lowCents, highCents, trades: filtered.length }`.

## Template change

`decide`'s `decideOffer` and the revised-offer path compute the band before building the `offer_received` intent. The `offer_received` template gains an optional `bandLine` variable:

```
offer_received: v =>
  `${v.code}: ${v.sellerAlias} offers ${v.qty} ${v.unit}, ${v.priceDisplay} credits, ${v.area}, hold till ${v.cutoff}. Reply ${v.ref} to hold.${v.bandLine ? '\n' + v.bandLine : ''}`
```

`bandLine` is set to `"Usual today: X,XXX-X,XXX (N trades)"` when `priceBand` returns a result, and omitted otherwise. The raw template still fits 160 septets (verified by the lint check with the longest realistic sample values).

## Lint verification

Longest realistic values used in template lint:
- code: `E99` (3)
- sellerAlias: `Ellis` (5)
- qty: `1` (1)
- unit: `crate` (5, after normalisation)
- priceDisplay: `9,999` (5)
- area: `Cedar Lane side` (15)
- cutoff: `17:59` (5)
- ref: `9 E99 v9` (8)
- bandLine: `Usual today: 9,999-9,999 (99 trades)` (37)

Base message: 92 septets. With newline + bandLine: 130 septets. Within 160.

## Privacy invariant

`priceBand` is called only inside `decideOffer`. The result feeds only the `offer_received` message, whose recipient is always the individual requester. The I8 checker already rejects prices in `seller_invited` and `request_routed_seller`; this change does not alter those paths.

## Seed design

The demo seed appends historical `DomainEvent` values representing completed trades before the interactive demo starts. The seed uses a separate fictional request series (codes `H1`, `H2`, … mapped via `nextRequestNumber` offset), fictional seller ids and prices that bracket a realistic range (e.g. 4100–4400 cents). At least 5 trades are seeded so the band is comfortably above the 3-trade minimum.
