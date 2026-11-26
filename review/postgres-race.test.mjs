import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createDatabase } from '../dist/src/infra/db/db.js'
import {
  appendEvents, cleanupWorkspace, createWorkspace, loadState, withWorkspaceLock,
} from '../dist/src/infra/db/market-repo.js'
import { decide } from '../dist/src/domain/decide.js'

test('real PostgreSQL serializes two buyers for one crate and replays a held deadline after reconnect', async () => {
  const workspaceId = randomUUID()
  const now = new Date('2026-11-21T14:00:00Z')
  const cutoffAt = new Date('2026-11-21T17:00:00Z')
  let db = createDatabase()
  try {
    await createWorkspace(db, workspaceId, 'demo')
    await appendEvents(db, workspaceId, [
      { type: 'circle_created', workspaceId, circleId: 'local', name: 'Local', at: now },
      ...['mara', 'ellis', 'jules'].map(traderId => ({
        type: 'trader_enrolled', workspaceId, traderId, alias: traderId,
        circleId: 'local', role: 'trader', at: now,
      })),
    ])

    const submit = command => withWorkspaceLock(db, workspaceId, async tx => {
      const state = await loadState(tx, workspaceId)
      const decision = decide(state, command, now)
      if (decision.ok) await appendEvents(tx, workspaceId, decision.events)
      return decision
    })

    for (const [index, buyer] of ['mara', 'jules'].entries()) {
      const request = await submit({
        kind: 'create_request', by: buyer, item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
        quantity: 1, cutoffAt,
      })
      assert.ok(request.ok)
      assert.ok((await submit({
        kind: 'offer', by: 'ellis', requestCode: `E${index + 1}`, priceCents: 420000, pickupArea: 'Cedar Lane',
      })).ok)
    }

    const outcomes = await Promise.all(['mara', 'jules'].map((by, index) => submit({
      kind: 'accept', by, requestCode: `E${index + 1}`, offerRef: '1', offerRevision: 1,
    })))
    assert.equal(outcomes.filter(result => result.ok).length, 1)
    await db.destroy()
    db = createDatabase()
    const state = await loadState(db, workspaceId)
    const live = [...state.holds.values()].filter(hold => hold.state === 'live')
    assert.equal(live.length, 1)
    assert.deepEqual(live[0].heldUntil, cutoffAt)
  } finally {
    await cleanupWorkspace(db, workspaceId)
    await db.destroy()
  }
})
