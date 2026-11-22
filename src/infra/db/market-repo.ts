// Repository layer for Market Wire persistence.

import { sql, type Kysely } from 'kysely'
import type { MarketState, WorkspaceId } from '../../domain/types.js'
import type { DomainEvent } from '../../domain/events.js'
import { TABLES, type MarketWireDB } from './schema.js'
import { replayEvents } from '../../domain/evolve.js'

function convertEventDates(event: unknown): DomainEvent {
  const e = event as Record<string, unknown>
  if (typeof e.at === 'string') e.at = new Date(e.at)
  if (typeof e.cutoffAt === 'string') e.cutoffAt = new Date(e.cutoffAt)
  if (typeof e.heldUntil === 'string') e.heldUntil = new Date(e.heldUntil)
  return e as unknown as DomainEvent
}

export async function loadState(db: Kysely<MarketWireDB>, workspaceId: WorkspaceId): Promise<MarketState> {
  const events = await db.selectFrom(TABLES.event).selectAll().where('workspace_id', '=', workspaceId).orderBy('id', 'asc').execute()
  return replayEvents(events.map((e) => convertEventDates(e.payload)), workspaceId)
}

export async function appendEvents(db: Kysely<MarketWireDB>, workspaceId: WorkspaceId, events: DomainEvent[]): Promise<void> {
  for (const event of events) {
    await db.insertInto(TABLES.event).values({ workspace_id: workspaceId, payload: event, created_at: event.at }).execute()
  }
}

export async function addOutboxMessages(db: Kysely<MarketWireDB>, workspaceId: WorkspaceId, generation: number, messages: unknown[]): Promise<void> {
  for (const msg of messages) {
    await db.insertInto(TABLES.outbox).values({ workspace_id: workspaceId, generation, dedupe_key: crypto.randomUUID(), payload: msg }).execute()
  }
}

export async function recordInboundReceipt(db: Kysely<MarketWireDB>, workspaceId: WorkspaceId, generation: number, messageId: string, result: unknown): Promise<void> {
  await db.insertInto(TABLES.inbound_receipt).values({ workspace_id: workspaceId, generation, message_id: messageId, result }).onConflict((oc) => oc.doNothing()).execute()
}

export async function withWorkspaceLock<T>(db: Kysely<MarketWireDB>, workspaceId: WorkspaceId, fn: (tx: Kysely<MarketWireDB>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`.execute(tx)
    return fn(tx)
  })
}

export async function createWorkspace(db: Kysely<MarketWireDB>, workspaceId: WorkspaceId, kind: 'demo' | 'live', tokenHash: string | null = null): Promise<void> {
  await db.insertInto(TABLES.workspace).values({ id: workspaceId, kind, token_hash: tokenHash, generation: 0, created_at: new Date(), clock_offset_ms: 0 }).onConflict((oc) => oc.doNothing()).execute()
}

export async function cleanupWorkspace(db: Kysely<MarketWireDB>, workspaceId: WorkspaceId): Promise<void> {
  await db.deleteFrom(TABLES.workspace).where('id', '=', workspaceId).execute()
}

export async function getWorkspace(db: Kysely<MarketWireDB>, workspaceId: WorkspaceId): Promise<{ kind: 'demo' | 'live'; generation: number } | null> {
  const result = await db.selectFrom(TABLES.workspace).selectAll().where('id', '=', workspaceId).executeTakeFirst()
  if (!result) return null
  return { kind: result.kind, generation: result.generation }
}

export async function bumpGeneration(db: Kysely<MarketWireDB>, workspaceId: WorkspaceId): Promise<void> {
  await db.updateTable(TABLES.workspace).set((eb) => ({ generation: eb('generation', '+', 1) })).where('id', '=', workspaceId).execute()
}
