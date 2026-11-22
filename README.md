# Market Wire V2

Market Wire helps a buyer find a spare crate after their usual supplier runs out. Local sellers get the first chance to help. The buyer decides if the shortage goes to a coordinator.

## Start the local simulator

Use Node.js 22 or later. From the project root:

```sh
npm ci
npm run build
node dist/src/index.js
```

Open http://127.0.0.1:3000. The prototype uses fictional traders and pickup places, generic credits, and a simulated market clock. Run the local pickup first, then create a second shortage, widen it from the buyer phone and route it from the coordinator room.

Start by sending Ellis’s quote. Mara sees a private range based on simulated completed trades. After she holds a quote, only Mara's phone shows the pickup code. At handover she reads it to the seller, who texts `GIVEN <code> E7`; or Mara replies `DONE E7`. Five wrong codes lock `GIVEN` for that pickup. The simulator records one pickup either way. The coordinator sees only aggregate counts in shortage alerts, independently of the buyer’s decision to share a specific request. The alert is inspired by Cybersyn's Cyberstride early-warning software.

## Verify the implementation

```sh
npm test
npm run build
node --test review/transport-regressions.test.mjs review/core-regressions.test.mjs review/check-report.test.mjs review/claude-fixes.test.mjs
```

Without a `DATABASE_URL`, the simulator uses in-memory sessions. To verify persistence, point `DATABASE_URL` at a dedicated disposable PostgreSQL database, run `npm run migrate`, then run `node --test review/postgres-race.test.mjs` and `node review/restart-smoke.mjs`. The local HTTP simulator persists session snapshots, while the event repository concurrency test uses its own transaction path.

With the simulator running, `npm run smoke` runs both cases and the expiry and stale-price checks. `node review/mcp-smoke.mjs` checks the companion stdio MCP server.

The Kiro spec starts in [.kiro/specs/market-wire](.kiro/specs/market-wire). [QA.md](QA.md) defines the release cases. [Build evidence](docs/evidence.md) records runs and outstanding checks. The acceptance checker takes a JSON report from the implementation:

```sh
node review/check-report.mjs path/to/acceptance-report.json
node --test review/check-report.test.mjs
```

The checker validates the shape and recorded outcomes of a run. Use the underlying test output to verify that the report reflects an actual run. Record the environment, revision and scenario evidence. Live SMS and field findings require separate verification.

| Work | Build tool | Evidence |
| --- | --- | --- |
| Market core and hold fixes | Kiro CLI | [Main spec](.kiro/specs/market-wire), [hold bugfix](.kiro/specs/bugfix-core-holds) |
| Quote and transport review fixes | Kiro CLI | [Quote integrity](.kiro/specs/bugfix-quote-integrity), [transport](.kiro/specs/bugfix-demo-transport), revision `f3d95bc` |
| Private price range | Kiro CLI, then Codex after Kiro reached its monthly limit | [Price band](.kiro/specs/price-band) |
| Shortage alerts, pickup codes and browser usability | Codex | [Shortage alerts](.kiro/specs/shortage-alert), [pickup codes](.kiro/specs/pickup-code), [build evidence](docs/evidence.md) |
| Review fixes after the follow-up build (pickup-code privacy and lockout, alert dedupe, silent replies) | Claude | [Build evidence](docs/evidence.md#review-fixes-22-november), `review/claude-fixes.test.mjs` |

## Deploying

`Dockerfile` builds the in-memory simulator and listens on `0.0.0.0:$PORT`. Set `DATABASE_URL` to a managed PostgreSQL 16 database for durable sessions. A public deployment needs the owner's approval and should stay up until judging ends on 29 January 2027.
