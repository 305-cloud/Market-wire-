import assert from 'node:assert/strict'
import { test } from 'node:test'
import fc from 'fast-check'
import { decide } from '../dist/src/domain/decide.js'
import { evolve } from '../dist/src/domain/evolve.js'
import { emptyMarketState } from '../dist/src/domain/types.js'

const workspaceId = 'review'
const start = new Date('2026-11-21T10:00:00Z')
const cutoff = new Date('2026-11-21T17:00:00Z')
const item = { name: 'eggs', grade: 'medium', unit: 'crate30' }

function market() {
  const enrollment = ['mara', 'jules', 'ellis'].map(traderId => ({
    type: 'trader_enrolled', workspaceId, traderId, alias: traderId,
    circleId: 'local', role: 'trader', at: start,
  }))
  const history = [
    { type: 'circle_created', workspaceId, circleId: 'local', name: 'Local', at: start },
    ...enrollment,
  ]
  let state = history.reduce(evolve, emptyMarketState(workspaceId))

  return {
    get state() {
      return state
    },
    history,
    send(command, now = start) {
      const result = decide(state, command, now)
      if (result.ok) {
        history.push(...result.events)
        state = result.events.reduce(evolve, state)
      }
      return result
    },
    offer(requestCode) {
      return this.send({
        kind: 'offer', by: 'ellis', requestCode, priceCents: 420000,
        pickupArea: 'Local', pickupDirections: 'Stall 4',
      })
    },
    request(by) {
      assert.ok(this.send({ kind: 'create_request', by, item, quantity: 1, cutoffAt: cutoff }).ok)
      return [...state.requests.keys()].at(-1)
    },
    accept(by, requestCode) {
      const offer = [...state.offers.values()].find(entry => entry.requestCode === requestCode)
      return this.send({
        kind: 'accept', by, requestCode, offerRef: offer.replyRef, offerRevision: offer.revision,
      })
    },
  }
}

test('a seller cannot offer the same allocated stock again while the original hold is live', () => {
  const wire = market()
  const first = wire.request('mara')
  const second = wire.request('jules')
  assert.ok(wire.offer(first).ok)
  assert.ok(wire.accept('mara', first).ok)
  const offer = wire.offer(second)
  if (offer.ok) assert.equal(wire.accept('jules', second).ok, false)
})

test('2,500 seeded stock races preserve single holds, collection and event replay', () => {
  const actions = fc.array(fc.constantFrom('offer', 'accept', 'collect', 'cancel', 'tick'), {
    minLength: 10,
    maxLength: 36,
  })
  const trace = fc.array(fc.record({ code: fc.boolean(), late: fc.boolean() }), {
    minLength: 36,
    maxLength: 36,
  })
  fc.assert(fc.property(actions, trace, (sequence, timings) => {
    const wire = market()
    const requests = [wire.request('mara'), wire.request('jules')]
    let late = false
    for (const [index, action] of sequence.entries()) {
      const { code, late: reachedDeadline } = timings[index]
      const requestCode = requests[Number(code)]
      const by = code ? 'jules' : 'mara'
      late ||= reachedDeadline && index > 6
      const now = late ? cutoff : start
      const previous = wire.state.requests.get(requestCode)
      const offer = [...wire.state.offers.values()].find(entry =>
        entry.requestCode === requestCode && entry.state === 'proposed')
      if (action === 'offer') {
        wire.send({ kind: 'offer', by: 'ellis', requestCode, priceCents: 420000, pickupArea: 'Local' }, now)
      } else if (action === 'accept' && offer) {
        wire.send({ kind: action, by, requestCode, offerRef: offer.replyRef, offerRevision: offer.revision }, now)
      } else if (action === 'collect' || action === 'cancel') {
        wire.send({ kind: action, by, requestCode }, now)
      } else if (action === 'tick') {
        wire.send({ kind: action }, now)
      }
      const after = wire.state.requests.get(requestCode)
      if (['cancelled', 'collected', 'expired'].includes(previous.state)) {
        assert.equal(after.state, previous.state)
      }
      const holds = [...wire.state.holds.values()]
      assert.ok(holds.filter(entry => entry.state === 'live').length <= 1)
      for (const candidate of requests) {
        assert.ok(holds.filter(entry => entry.requestCode === candidate && entry.state === 'collected').length <= 1)
      }
    }
    assert.deepEqual(wire.history.reduce(evolve, emptyMarketState(workspaceId)), wire.state)
  }), { seed: 1972, numRuns: 2500 })
})

test('DONE cannot collect an expired hold before the scheduler has ticked', () => {
  const wire = market()
  const requestCode = wire.request('mara')
  assert.ok(wire.offer(requestCode).ok)
  assert.ok(wire.accept('mara', requestCode).ok)
  const late = new Date(cutoff.getTime() + 1)
  assert.equal(wire.send({ kind: 'collect', by: 'mara', requestCode }, late).ok, false)
})

test('a widened request with no confirmed pickup receives an early fallback once', () => {
  const wire = market()
  const requestCode = wire.request('mara')
  assert.ok(wire.send({ kind: 'widen', by: 'mara', requestCode }).ok)
  assert.ok(wire.offer(requestCode).ok)
  const threshold = new Date(cutoff.getTime() - 30 * 60_000)
  const fallbackCount = result => result.outbound.filter(entry => entry.template === 'fallback_buyer').length
  assert.equal(fallbackCount(wire.send({ kind: 'tick' }, threshold)), 1)
  assert.equal(fallbackCount(wire.send({ kind: 'tick' }, threshold)), 0)
})
