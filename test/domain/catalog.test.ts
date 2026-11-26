import { describe, it, expect } from 'vitest'
import { findItem, unitWordFor, plainUnits, CATALOG } from '../../src/domain/catalog.js'
import { parseCreateRequest, parseSellerQuote } from '../../src/parser/interpret.js'
import { readTrader, looksCanonical } from '../../src/parser/lexicon.js'

const now = new Date('2026-11-20T09:00:00Z')

describe('catalogue', () => {
  it('finds items by name in several languages', () => {
    expect(findItem('need 1 sack flour')?.name).toBe('flour')
    expect(findItem('necesito 1 saco de harina')?.name).toBe('flour')
    expect(findItem('besoin 1 sac de riz')?.name).toBe('rice')
    expect(findItem('nahitaji mtungi wa gesi')?.name).toBe('gas')
    expect(findItem('1 bag cooking gas')?.name).toBe('gas')
    expect(findItem('1 kg kaffee')?.name).toBe('coffee')
    expect(findItem('tomatoes')).toBeUndefined()
    expect(findItem('eggplant')).toBeUndefined()
  })

  it('gives every item one unit, shown as a plain word', () => {
    for (const item of CATALOG) expect(unitWordFor(item.unit)).toBe(item.unitWord)
    expect(plainUnits('1 sack25kg flour, 1 cylinder13kg gas')).toBe('1 sack flour, 1 cylinder gas')
    expect(unitWordFor('crate30')).toBe('tray') // sessions saved by earlier builds
  })
})

describe('requests for catalogue items', () => {
  it('stores the item\'s own unit whatever unit word the buyer typed', () => {
    const cmd = parseCreateRequest('NEED 1 SACK FLOUR BEFORE 5PM', 'mara', now)
    expect(cmd).toMatchObject({ kind: 'create_request', item: { name: 'flour', unit: 'sack25kg' }, quantity: 1 })
    expect(parseCreateRequest('need 1 bag gas before 6pm', 'mara', now)).toMatchObject({ item: { name: 'gas', unit: 'cylinder13kg' } })
    expect(parseCreateRequest('need 2 trays eggs by 4pm', 'mara', now)).toMatchObject({ item: { name: 'eggs', unit: 'tray30' }, quantity: 2 })
  })

  it('names an unknown item so the server can refuse it plainly', () => {
    expect(parseCreateRequest('need 1 crate tomato before 5pm', 'mara', now)).toMatchObject({ item: { name: 'tomato' } })
  })

  it('accepts a price written with any common currency sign, stored as credits in cents', () => {
    for (const p of ['4200', '$4200', '€4,200', '£4200', '₹4200', '₦4200', 'KES4200', '4.2k']) {
      expect(parseSellerQuote(`E7 ${p} Cedar Lane`, 'ellis'), p).toMatchObject({ priceCents: 420000, pickupArea: 'Cedar Lane' })
    }
  })
})

describe('reader', () => {
  it('reads shorthand in other languages into the canonical command', () => {
    expect(readTrader('necesito 1 saco harina antes 5pm')?.text).toBe('NEED 1 SACK FLOUR BEFORE 5PM')
    expect(readTrader('besoin 2 sacs de riz avant 6pm')?.text).toBe('NEED 2 SACK RICE BEFORE 6PM')
    expect(readTrader('pls need 1 gas cylinder b4 4pm')?.text).toBe('NEED 1 CYLINDER GAS BEFORE 4PM')
  })

  it('leaves canonical requests for any catalogue item alone', () => {
    expect(looksCanonical('NEED 1 SACK FLOUR BEFORE 5PM')).toBe(true)
    expect(looksCanonical('NEED 1 CYLINDER GAS BY 18:00')).toBe(true)
    expect(looksCanonical('NEED 1 TRAY EGGS BEFORE 6')).toBe(true)
  })
})
