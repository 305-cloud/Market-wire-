// Initial migration: create core tables for Market Wire.

import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { MarketWireDB } from '../schema.js'

export async function up(db: Kysely<MarketWireDB>): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await sql`CREATE TABLE IF NOT EXISTS workspace (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('demo', 'live')),
        token_hash TEXT,
        generation INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        clock_offset_ms BIGINT NOT NULL DEFAULT 0
      )`.execute(tx)

    await sql`CREATE TABLE IF NOT EXISTS event (
        id BIGSERIAL PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`.execute(tx)

    await sql`CREATE TABLE IF NOT EXISTS inbound_receipt (
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        generation INTEGER NOT NULL,
        message_id TEXT NOT NULL,
        result JSONB NOT NULL,
        PRIMARY KEY (workspace_id, generation, message_id)
      )`.execute(tx)

    await sql`CREATE TABLE IF NOT EXISTS outbox (
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        generation INTEGER NOT NULL,
        dedupe_key TEXT NOT NULL,
        payload JSONB NOT NULL,
        PRIMARY KEY (workspace_id, generation, dedupe_key)
      )`.execute(tx)

    await sql`CREATE INDEX IF NOT EXISTS inbound_receipt_workspace_gen_msg ON inbound_receipt (workspace_id, generation, message_id)`.execute(tx)

    await sql`CREATE INDEX IF NOT EXISTS outbox_workspace_gen_dedupe ON outbox (workspace_id, generation, dedupe_key)`.execute(tx)
  })
}

export async function down(db: Kysely<MarketWireDB>): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await sql`DROP TABLE IF EXISTS outbox CASCADE`.execute(tx)
    await sql`DROP TABLE IF EXISTS inbound_receipt CASCADE`.execute(tx)
    await sql`DROP TABLE IF EXISTS event CASCADE`.execute(tx)
    await sql`DROP TABLE IF EXISTS workspace CASCADE`.execute(tx)
  })
}
