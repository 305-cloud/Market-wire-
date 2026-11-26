import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { priceBand } from '../../src/domain/price-band.js'
import { reliability } from '../../src/domain/reliability.js'
import { emptyMarketState, type Item } from '../../src/domain/types.js'
import { checkInvariants } from '../../src/domain/invariants.js'
import { gsmSeptetCount, renderTemplate } from '../../src/messages/templates.js'

const now = new Date('2026-11-22T15:00:00Z')
const eggs: Item = { name: 'eggs', grade: 'medium', unit: 'crate30' }

describe('trader features', () => {
  it('uses nearest ranks over the exact price window, with at least three matching trades', () => {
    const state = emptyMarketState('demo')
    const trade = (priceKobo: number, offset: number, item = eggs, circleId = 'local') =>
      ({ item, circleId, priceKobo, collectedAt: new Date(now.getTime() + offset) })
    state.priceHistory = [trade(100, 0), trade(200, -86_400_000), trade(999, 1),
      trade(999, -86_400_001), trade(999, 0, { ...eggs, grade: 'large' }), trade(999, 0, eggs, 'north')]
    expect(priceBand(state, eggs, 'local', now)).toBeNull()
    state.priceHistory.push(trade(300, -1))
    expect(priceBand(state, eggs, 'local', now)).toEqual({ lowKobo: 100, highKobo: 300, trades: 3 })
  })

  it('keeps private variables out of circle-wide texts for generated values', () => {
    fc.assert(fc.property(fc.integer({ min: 100, max: 999 }), fc.integer({ min: 3, max: 200 }),
      (pickupCode, count) => {
        const vars = { code: 'E7', name: 'eggs', qty: 1, cutoff: '18:00',
          pickupCode, record: count + ' done', bandLine: 'Usual today: 4,200-4,400 (5 trades)' }
        const outbound = (['seller_invited', 'request_routed_seller'] as const).map(template =>
          ({ to: 'ellis', template, vars, dedupeKey: template, body: renderTemplate(template, vars) }))
        expect(checkInvariants(emptyMarketState('demo'), outbound)).toEqual([])
        for (const message of outbound) expect(message.body).not.toMatch(/usual|done|pickup code|4,200/i)
      }))
  })

  it('keeps the hold reply within one message for a long pickup area', () => {
    const message = renderTemplate('offer_received', {
      code: 'E1000', sellerAlias: 'Rowan', qty: 1, unit: 'crate30', priceDisplay: '1,000,000',
      area: '['.repeat(32), cutoff: '18:00', ref: '99 V3', record: '14 done',
      bandLine: 'Usual today: 100,000-1,000,000 (123 trades)',
    })
    expect(gsmSeptetCount(message)).toBeLessThanOrEqual(160)
    expect(message).toContain('99 V3')
  })

  it('counts completed exchanges and expired buyer holds without counting cancellations', () => {
    const state = emptyMarketState('demo')
    state.requests.set('E7', { code: 'E7', requesterId: 'mara', item: eggs, quantity: 1,
      cutoffAt: now, state: 'collected', widenedAt: null, invitedSellerIds: [], fallbackSentAt: null })
    for (const [id, status] of ['collected', 'collected', 'collected', 'released', 'expired'].entries()) {
      state.holds.set(String(id), { id: String(id), requestCode: 'E7', offerId: 'offer', crateId: 'crate',
        heldUntil: now, state: status as 'collected' | 'released' | 'expired' })
    }
    expect(reliability(state, 'mara')).toEqual({ done: 3, missed: 1 })
    expect(reliability(state, 'ellis')).toBe('new')
  })
})
