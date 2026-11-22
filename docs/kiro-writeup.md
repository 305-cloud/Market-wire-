# How we used Kiro

> **DRAFT, 22 Nov 2026.** Sections marked **TO DO (needs Kiro credits)** describe work planned for after the hackathon credits arrive. Before submitting, either replace each one with what actually happened, with links, or delete it. Every claim below links to a file or a commit. Don't add a claim without one.

## What Kiro built, and what it didn't

Kiro wrote the product's core:
- the event-sourced market (`decide`/`evolve`) and the invariants I1–I9;
- the SMS grammar and parser;
- the bug fixes recorded as Kiro specs;
- the first price-band implementation.

Kiro reached its monthly credit limit partway through the follow-up features, so two other AI assistants finished some of the work. Codex finished the price band and built the shortage alerts, pickup codes and browser usability work. Claude fixed review findings on 22 Nov. The table in the [README](../README.md) and the [build evidence](evidence.md) list who wrote what. We disclose this rather than blur it.

## Spec-driven development versus vibe coding

- **The core started as a spec, not a prompt.** [.kiro/specs/market-wire](../.kiro/specs/market-wire) holds the requirements, the design (event-sourced, pure `decide`/`evolve`, invariants as named properties) and the task list Kiro worked through. The spec fixes the rules that matter in a real shortage: one crate, one hold; a repeated DONE changes nothing; the coordinator sees a request only if the buyer widens it.
- **Where the spec was tight, Kiro's code was right first time** (the hold and collection logic). Where it was loose (the HTTP glue, number formats), independent reviews found bugs. We fed each one back as a spec rather than patching by hand. That's the main thing we learned: Kiro is as good as the spec you give it.

## Bugfix specs

Each real failure became a Kiro bugfix spec, with the failing test as its regression:
- [bugfix-core-holds](../.kiro/specs/bugfix-core-holds): a second offer could mint a second crate; a late DONE could collect an expired hold; a widened request missed its fallback.
- [bugfix-quote-integrity](../.kiro/specs/bugfix-quote-integrity) and [bugfix-demo-transport](../.kiro/specs/bugfix-demo-transport): eight bugs from an independent review, including prices shown at 1/100, reply numbers reused across sellers, and guessing on a bare CANCEL. Revision `f3d95bc`. All eight repros pass.
- [parser-pm-hour-bugfix](../.kiro/specs/market-wire/parser-pm-hour-bugfix.md): "before 8" in the evening.

## Property-based testing

The invariants are checked by property tests and seeded sequences, not only examples:
- 2,500 seeded random reservation and replay sequences in `review/core-regressions.test.mjs`;
- the fast-check properties in `test/`.

A property failure is what produced the first bugfix spec.

## Steering

[.kiro/steering](../.kiro/steering) keeps Kiro on the product's rules in every session:
- `privacy.md`: no price, code or record in circle-wide texts (I8); alerts are aggregate only (I10);
- `sms-style.md`: 160 GSM-7 characters, plain words, one action per text;
- `vocabulary.md`: the trader words the parser must accept, such as "done o";
- `product.md`, `tech.md` and `structure.md`.

## MCP

`src/mcp/server.ts` is a stdio MCP server that drives isolated demo markets. Its tools are `market_create`, `market_send`, `market_send_duplicate` (a gateway retry), `market_send_late`, `market_state`, `market_events`, `market_shortages` and `market_advance_clock`, configured in [.kiro/settings/mcp.json](../.kiro/settings/mcp.json). Agents use it to act as traders and check the invariants against the event log.

**TO DO (needs Kiro credits):** the recorded "agents attack the market" session. Kiro sub-agents play buyer, seller and a dishonest seller through MCP. Every finding is logged in `evidence.md` with accept or reject.

## Agent hooks

**TO DO (needs Kiro credits):** two hooks:
1. on save in `src/messages/`: run the template linter (160 characters, no price or code in circle texts);
2. on save in `src/domain/`: run the property tests.

Record one commit where a hook caught a real problem.

## Kiro CLI in CI

**TO DO (needs Kiro credits):** a CI job runs Kiro CLI headless on a failing test and drafts a bugfix spec as a pull-request comment. CI already runs the type-check, unit tests, regressions, the PostgreSQL race and the restart smoke ([ci.yml](../.github/workflows/ci.yml)).

## Custom agents and powers

- **Custom agents: TO DO if credits allow.** A read-only "market breaker" agent, limited to the MCP tools.
- **Powers:** not used. The project needed no third-party integration that a power would have simplified.
