// Database schema for Market Wire.

import type { Generated, Selectable } from 'kysely'
import type { DomainEvent } from '../../domain/events.js'

export interface WorkspaceRow { id: string; kind: 'demo' | 'live'; token_hash: string | null; generation: number; created_at: Date; clock_offset_ms: number }
export interface EventRow { id: Generated<number>; workspace_id: string; payload: DomainEvent; created_at: Date }
export interface InboundReceiptRow { workspace_id: string; generation: number; message_id: string; result: unknown }
export interface OutboxRow { workspace_id: string; generation: number; dedupe_key: string; payload: unknown }

export interface MarketWireDB { workspace: Selectable<WorkspaceRow>; event: EventRow; inbound_receipt: Selectable<InboundReceiptRow>; outbox: Selectable<OutboxRow> }

export const TABLES = { workspace: 'workspace', event: 'event', inbound_receipt: 'inbound_receipt', outbox: 'outbox' } as const

export function getWorkspaceStreamId(workspaceId: string) { return `workspace|${workspaceId}` }
