# Structure

Updated 22 Nov 2026 to match the code as built. Planned files that don't exist yet are listed separately, so nobody mistakes them for real ones.

```
src/
  index.ts      entry point (PORT, HOST)
  domain/       types.ts commands.ts events.ts decide.ts evolve.ts invariants.ts
                price-band.ts shortage.ts reliability.ts
  app/          resolve-target.ts
  parser/       grammar.ts interpret.ts rule-interpreter.ts
  messages/     templates.ts
  http/         server.ts (demo API, seeding, static web) demo-persistence.ts (PostgreSQL session snapshots)
  infra/db/     db.ts schema.ts market-repo.ts migrate.ts migrations/0001_init.ts
  mcp/          server.ts (stdio MCP server over the demo API)
web/            index.html client.js
test/
  domain/       decide.test.ts trader-features.test.ts
  parser/       grammar.test.ts interpret.test.ts pm-hour-bugfix.test.ts resolve-target.test.ts rule-interpreter.test.ts
review/         independent Node suites: core-regressions (2,500 seeded races), transport-regressions,
                claude-fixes, postgres-race, restart-smoke, api-smoke, mcp-smoke, check-report
```

Planned, not built: `src/channels/sms-gateway.ts` (Android SMS gateway; already listed in `.kiroignore` so the gateway's credentials stay out of Kiro's context), an LLM interpreter, and `.kiro/hooks` and `.kiro/agents`.
