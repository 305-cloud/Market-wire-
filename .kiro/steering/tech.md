# Tech

Node.js 22 LTS, TypeScript (strict, NodeNext modules), Fastify 5, PostgreSQL 16, Kysely (typed queries and migrations), zod (runtime validation), Vitest (unit and integration tests), fast-check (property-based tests), @modelcontextprotocol/sdk (MCP simulator server), pino (structured logging), GitHub Actions (CI).

Demo quotes use generic credits and integer minor units. Time is stored as timestamptz in UTC and displayed on the simulated market clock. Every state change is an appended domain event plus an outbox row in the same transaction. Per-market advisory locks prevent concurrent state corruption.

LLM_ENABLED=false is the default. The rule interpreter handles all standard flows without a model.
