// test/parser/grammar.test.ts
import { describe, it, expect } from 'vitest'
import { parseReply } from '../../src/parser/grammar.js'

describe('parseReply', () => {
  // ---------------------------------------------------------------------------
  // Accept with numbered reference
  // ---------------------------------------------------------------------------

  it('parses bare "1"', () => {
    expect(parseReply('1')).toEqual({ kind: 'accept', offerRef: 1 })
  })

  it('parses "1." with trailing dot', () => {
    expect(parseReply('1.')).toEqual({ kind: 'accept', offerRef: 1 })
  })

  it('parses "1 E7" with request code', () => {
    expect(parseReply('1 E7')).toEqual({ kind: 'accept', offerRef: 1, code: 'E7' })
  })

  it('parses "1 e7" lowercase code', () => {
    expect(parseReply('1 e7')).toEqual({ kind: 'accept', offerRef: 1, code: 'E7' })
  })

  it('parses "2" for second offer', () => {
    expect(parseReply('2')).toEqual({ kind: 'accept', offerRef: 2 })
  })

  it('parses "3 E10"', () => {
    expect(parseReply('3 E10')).toEqual({ kind: 'accept', offerRef: 3, code: 'E10' })
  })

  // ---------------------------------------------------------------------------
  // DONE / collect
  // ---------------------------------------------------------------------------

  it('parses "DONE"', () => {
    expect(parseReply('DONE')).toEqual({ kind: 'collect' })
  })

  it('parses "done"', () => {
    expect(parseReply('done')).toEqual({ kind: 'collect' })
  })

  it('parses "done o"', () => {
    expect(parseReply('done o')).toEqual({ kind: 'collect' })
  })

  it('parses "DONE."', () => {
    expect(parseReply('DONE.')).toEqual({ kind: 'collect' })
  })

  // ---------------------------------------------------------------------------
  // STOP / HELP / CANCEL / WIDEN
  // ---------------------------------------------------------------------------

  it('returns null for STOP', () => {
    expect(parseReply('STOP')).toBeNull()
  })

  it('returns null for HELP', () => {
    expect(parseReply('HELP')).toBeNull()
  })

  it('returns null for CANCEL', () => {
    expect(parseReply('CANCEL')).toBeNull()
  })

  it('returns null for WIDEN', () => {
    expect(parseReply('WIDEN')).toBeNull()
  })

  it('returns null for WIDEN E7', () => {
    expect(parseReply('WIDEN E7')).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // Invalid inputs
  // ---------------------------------------------------------------------------

  it('rejects empty string', () => {
    expect(parseReply('')).toBeNull()
  })

  it('rejects random text', () => {
    expect(parseReply('hello')).toBeNull()
  })

  it('rejects "1.5" (decimal not allowed)', () => {
    expect(parseReply('1.5')).toBeNull()
  })

  it('rejects "E7" alone', () => {
    expect(parseReply('E7')).toBeNull()
  })
})