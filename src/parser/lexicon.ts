// src/parser/lexicon.ts
// Rule-based reader for messy trader texts (22 Nov 2026, Claude). No model and no network:
// a ~1,200-entry lexicon (lexicon-data.ts), longest-phrase matching, and a small edit-distance
// fallback for typos. It rewrites a text into the canonical command language when it is sure,
// and otherwise proposes the canonical text for the trader to confirm.

import { LEXICON, type LexKind } from './lexicon-data.js'

type Entry = { canonical: string; kind: LexKind; sure: boolean }
type Token = { raw: string; canonical: string; kind: LexKind | 'code' | 'digit' | 'clock' | 'unknown'; sure: boolean }

export interface Reading {
  /** Canonical text the existing parsers understand, e.g. "NEED 1 CRATE EGGS BEFORE 5PM". */
  text: string
  /** False when any word was guessed (typo match or an ambiguous word): ask the trader first. */
  sure: boolean
}

const PHRASES = new Map<string, Entry>()
// Everyday words that misfire as commands (consumer review, 22 Nov): 'egg don finish', 'hold 1', 'i don reach'.
const SKIP = new Set(['don', 'hold', 'got', 'good', 'on', 'off', 'other', 'else', 'mind', 'far', 'further', 'finish', 'reached', 'reach me', 'e don reach', 'e don reach me', 'drop', 'void', 'join', 'return', 'continue', 'sub', 'how'])
let longest = 1
for (const [variant, canonical, kind, sure] of LEXICON) {
  const key = variant.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!key || PHRASES.has(key) || SKIP.has(key)) continue
  PHRASES.set(key, { canonical, kind, sure })
  longest = Math.max(longest, key.split(' ').length)
}
// Typo fallback only matches the words that matter (commands, items, units), never fillers.
const TYPO_TARGETS = [...PHRASES.entries()].filter(([variant, entry]) =>
  !variant.includes(' ') && variant.length >= 5 && entry.sure && ['command', 'item', 'unit'].includes(entry.kind))

/** Damerau-Levenshtein distance, capped: returns cap + 1 as soon as the distance exceeds cap. */
export function editDistance(a: string, b: string, cap = 2): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1)
      d[i]![j] = v
      rowMin = Math.min(rowMin, v)
    }
    if (rowMin > cap) return cap + 1
  }
  return d[a.length]![b.length]!
}

export function tokenize(text: string): Token[] {
  const words = text.toLowerCase()
    .replace(/[“”"'’`]/g, '')
    .replace(/(\d)\s*(am|pm)\b/g, '$1$2')
    .replace(/[^a-z0-9:₦\s]/g, ' ')
    .split(/\s+/).filter(Boolean)
  const tokens: Token[] = []
  for (let i = 0; i < words.length;) {
    let matched = false
    for (let n = Math.min(longest, words.length - i); n >= 1; n--) {
      const phrase = words.slice(i, i + n).join(' ')
      const entry = PHRASES.get(phrase)
      if (entry && !(n === 1 && /^\d/.test(phrase) && entry.kind !== 'number')) {
        tokens.push({ raw: phrase, canonical: entry.canonical, kind: entry.kind, sure: entry.sure })
        i += n
        matched = true
        break
      }
    }
    if (matched) continue
    const w = words[i]!
    i++
    if (/^e\d+$/.test(w)) tokens.push({ raw: w, canonical: w.toUpperCase(), kind: 'code', sure: true })
    else if (/^\d{1,2}(:\d{2})?(am|pm)$/.test(w) || /^\d{1,2}:\d{2}$/.test(w)) tokens.push({ raw: w, canonical: w.toUpperCase(), kind: 'clock', sure: true })
    else if (/^\d+$/.test(w)) tokens.push({ raw: w, canonical: w, kind: 'digit', sure: true })
    else {
      const cap = w.length >= 7 ? 2 : 1
      const best = w.length >= 5
        ? TYPO_TARGETS.map(([variant, entry]) => ({ entry, d: editDistance(w, variant, cap) })).filter(x => x.d <= cap).sort((a, b) => a.d - b.d)[0]
        : undefined
      tokens.push(best
        ? { raw: w, canonical: best.entry.canonical, kind: best.entry.kind, sure: false }
        : { raw: w, canonical: '', kind: 'unknown', sure: true })
    }
  }
  return tokens
}

const SIMPLE = new Set(['DONE', 'CANCEL', 'WIDEN', 'STOP', 'START', 'PAUSE', 'RESUME', 'HELP'])

/** Read a messy trader text. Returns null when it can't produce a canonical command. */
export function readTrader(text: string): Reading | null {
  const tokens = tokenize(text)
  if (!tokens.length) return null
  const commands = tokens.filter(t => t.kind === 'command').map(t => t.canonical.split(' ')[0]!)
  const code = tokens.find(t => t.kind === 'code')?.canonical
  const unknown = tokens.filter(t => t.kind === 'unknown').length
  let sure = tokens.every(t => t.sure)

  // Seller handover: GIVEN + a three-digit code
  if (commands.includes('GIVEN')) {
    const pin = tokens.find(t => t.kind === 'digit' && /^\d{3}$/.test(t.canonical))?.canonical
    if (!pin) return null
    // Never close a deal from a reading: GIVEN always asks for a YES first.
    return { text: `GIVEN ${pin}${code ? ' ' + code : ''}`, sure: false }
  }

  const items = tokens.filter(t => t.kind === 'item').map(t => t.canonical)
  const itemPhrase = tokens.find(t => t.kind === 'unit' && /\b(EGGS|MILK)\b/.test(t.canonical))
  // A command phrase such as "any eggs" can swallow the item word, so fall back to the raw text.
  const item = items.find(i => /EGGS|MILK/.test(i))?.match(/EGGS|MILK/)?.[0] ?? itemPhrase?.canonical.match(/EGGS|MILK/)?.[0] ??
    (/\beg+s?\b|\beggs?\b/i.test(text) ? 'EGGS' : /\bmilk\b/i.test(text) ? 'MILK' : undefined)
  const wantsStock = commands.includes('NEED') || (!!item && !commands.some(c => SIMPLE.has(c)))

  if (wantsStock) {
    if (!item) return null
    // The quantity comes before the time word; the number after BEFORE is the hour.
    const timeAt = tokens.findIndex(t => t.kind === 'time')
    const number = tokens.slice(0, timeAt < 0 ? undefined : timeAt)
      .find(t => t.kind === 'number' || (t.kind === 'digit' && Number(t.canonical) < 100))
    const quantity = number ? number.canonical : '1'
    if (!number) sure = false
    // Time: a phrase that already says BEFORE ..., or BEFORE/BY followed by a clock or bare hour.
    let time: string | undefined
    const timePhrase = tokens.find(t => t.kind === 'time' && /^BEFORE \S/.test(t.canonical))
    if (timePhrase) time = timePhrase.canonical
    else {
      const at = tokens.findIndex(t => t.kind === 'time' && t.canonical === 'BEFORE')
      const next = at >= 0 ? tokens.slice(at + 1).find(t => t.kind === 'clock' || t.kind === 'digit' || t.kind === 'number' || (t.kind === 'time' && /\d/.test(t.canonical))) : undefined
      const clockOnly = tokens.find(t => t.kind === 'clock')
      const value = next?.canonical ?? clockOnly?.canonical
      if (value) time = 'BEFORE ' + value
    }
    if (!time) return null
    if (unknown > 2) sure = false
    return { text: `NEED ${quantity} CRATE ${item} ${time}`, sure }
  }

  const simple = commands.find(c => SIMPLE.has(c))
  if (simple) {
    if (unknown > 1) return null
    // Commands that change or close a deal always ask for a YES first; only HELP runs straight away.
    return { text: simple + (code ? ' ' + code : ''), sure: simple === 'HELP' && sure && unknown === 0 }
  }
  return null
}

/** True when a text is already in a form the strict parsers accept, so the reader must leave it alone. */
export function looksCanonical(text: string): boolean {
  const t = text.trim()
  return /^E\d+\b/i.test(t) ||
    /^\d+\.?(\s+E\d+)?(\s+V\d+)?[.!?]?$/i.test(t) ||
    /^(DONE|CANCEL|WIDEN|STOP|START|PAUSE|RESUME|HELP)(\s+E\d+)?(\s+(o+|pls|please|thanks|thank you|now|abeg))*(\s+E\d+)?[.!?]*$/i.test(t) ||
    /^GIVEN\s+\d{3}(\s+E\d+)?[.!?]?$/i.test(t) ||
    /^(YES|NO|STATUS)[.!?]?$/i.test(t) ||
    /^NEED\s+\d+\s+(CRATES?|TRAYS?)\s+(EGGS|MILK)\s+(BEFORE|BY)\s+\d{1,2}(:\d{2})?\s*(AM|PM)?[.!?]?$/i.test(t)
}
