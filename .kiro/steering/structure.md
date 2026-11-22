# Structure

```
src/
  domain/     types.ts commands.ts events.ts decide.ts evolve.ts invariants.ts
  messages/   templates.ts
  app/        handle.ts ingest.ts resolve-target.ts
  infra/db/   db.ts schema.ts market-repo.ts migrations/0001_init.ts migrate.ts
  infra/      clock.ts outbox.ts scheduler.ts bus.ts
  channels/   channel.ts simulator.ts sms-gateway.ts
  parser/     grammar.ts interpret.ts rule-interpreter.ts llm-interpreter.ts vocabulary.json
  http/       server.ts demo-routes.ts coordinator-routes.ts webhook-routes.ts stream.ts security.ts
  mcp/        server.ts tools.ts
  seed/       demo-market.ts
web/          index.html client.js
scripts/      lint-templates.ts smoke.ts live-enrol.ts
test/
  domain/     decide.test.ts
  property/   model.property.test.ts seeds.json
  parser/     grammar.test.ts rule-interpreter.test.ts resolve-target.test.ts
  integration/ tick.test.ts isolation.test.ts ingest.test.ts outbox.test.ts api.test.ts
  mcp/        tools.test.ts
```
