// src/http/demo-persistence.ts
// PostgreSQL-backed durable storage for demo sessions.
// Falls back to in-memory mode when DATABASE_URL is not set.

import { Pool } from 'pg'
import { createHash } from 'node:crypto'
import type { DomainEvent } from '../domain/events.js'
import type { Market } from './server.js'

const DATABASE_URL = process.env.DATABASE_URL

let pool: Pool | null = null

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function reviveEvent(event: DomainEvent): DomainEvent {
  const at = new Date(String(event.at))
  if (event.type === 'request_created') {
    const cutoffAt = new Date(String(event.cutoffAt))
    return { ...event, at, cutoffAt }
  }
  if (event.type === 'hold_created') {
    const heldUntil = new Date(String(event.heldUntil))
    return { ...event, at, heldUntil }
  }
  return { ...event, at }
}

export async function initPersistence(): Promise<boolean> {
  if (!DATABASE_URL) return false
  pool = new Pool({ connectionString: DATABASE_URL })
  try {
    const client = await pool.connect()
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS demo_session_snapshot (
          demo_market_id TEXT PRIMARY KEY,
          events JSONB NOT NULL DEFAULT '[]'::jsonb,
          messages JSONB NOT NULL DEFAULT '[]'::jsonb,
          dedupe JSONB NOT NULL DEFAULT '[]'::jsonb,
          token_hash TEXT NOT NULL,
          base_time TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        ALTER TABLE demo_session_snapshot ALTER COLUMN base_time SET DATA TYPE TIMESTAMPTZ;
      `)
      // Expire old sessions on startup
      await expireOldSnapshots()
    } finally {
      client.release()
    }
    return true
  } catch (err) {
    pool = null
    throw new Error(`Failed to initialize demo persistence: ${err}`)
  }
}

// ---------------------------------------------------------------------------
// TTL management (24-hour demo session expiry)
// ---------------------------------------------------------------------------

const DEMO_SESSION_TTL_MS = 24 * 60 * 60 * 1000

/** Delete all snapshots older than 24 hours. Returns count of deleted rows. */
export async function expireOldSnapshots(): Promise<number> {
  if (!pool) return 0
  const result = await pool.query(
    `DELETE FROM demo_session_snapshot WHERE created_at < now() - INTERVAL '24 hours' RETURNING demo_market_id`,
  )
  return result.rowCount ?? 0
}

export async function closePersistence(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export async function saveSnapshot(market: Market): Promise<void> {
  if (!pool) throw new Error('Persistence not initialized')
  const dedupeArray = Array.from(market.dedupe)
  await pool.query(
    `INSERT INTO demo_session_snapshot (demo_market_id, events, messages, dedupe, token_hash, base_time, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (demo_market_id) DO UPDATE SET
       events = EXCLUDED.events,
       messages = EXCLUDED.messages,
       dedupe = EXCLUDED.dedupe,
       token_hash = CASE WHEN $5 = '' THEN demo_session_snapshot.token_hash ELSE EXCLUDED.token_hash END,
       base_time = EXCLUDED.base_time,
       updated_at = EXCLUDED.updated_at`,
    [market.id, JSON.stringify(market.events), JSON.stringify(market.messages), JSON.stringify(dedupeArray), market.token ? hashToken(market.token) : '', market.baseTime],
  )
}

export async function loadSnapshot(marketId: string): Promise<Market | null> {
  if (!pool) throw new Error('Persistence not initialized')
  const result = await pool.query(
    'SELECT demo_market_id, events, messages, dedupe, token_hash, base_time, created_at FROM demo_session_snapshot WHERE demo_market_id = $1',
    [marketId],
  )
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  return {
    id: row.demo_market_id,
    token: '',
    baseTime: row.base_time ?? row.created_at,
    createdAtMs: new Date(row.created_at).getTime(),
    events: row.events.map(reviveEvent),
    messages: row.messages,
    dedupe: new Set(row.dedupe),
  }
}

export async function loadRecentSnapshots(): Promise<Map<string, Market>> {
  if (!pool) throw new Error('Persistence not initialized')
  // Clean up any expired sessions before loading
  await expireOldSnapshots()
  const result = await pool.query(
    `SELECT demo_market_id, events, messages, dedupe, token_hash, base_time, created_at
     FROM demo_session_snapshot WHERE created_at > now() - INTERVAL '24 hours'`,
  )
  const markets = new Map<string, Market>()
  for (const row of result.rows) {
    markets.set(row.demo_market_id, {
      id: row.demo_market_id,
      token: '',
      baseTime: row.base_time ?? row.created_at,
      createdAtMs: new Date(row.created_at).getTime(),
      events: row.events.map(reviveEvent),
      messages: row.messages,
      dedupe: new Set(row.dedupe),
    })
  }
  return markets
}

export async function deleteSnapshot(marketId: string): Promise<void> {
  if (!pool) throw new Error('Persistence not initialized')
  await pool.query('DELETE FROM demo_session_snapshot WHERE demo_market_id = $1', [marketId])
}

export async function verifyTokenHash(marketId: string, token: string): Promise<boolean> {
  if (!pool) throw new Error('Persistence not initialized')
  const result = await pool.query('SELECT token_hash FROM demo_session_snapshot WHERE demo_market_id = $1', [marketId])
  if (result.rows.length === 0) return false
  return hashToken(token) === result.rows[0].token_hash
}

export function isPersistenceEnabled(): boolean {
  return pool !== null
}