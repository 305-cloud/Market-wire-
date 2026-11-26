// src/parser/interpret.ts
// Parse inbound SMS messages into domain commands.
// Handles: plain request, anchored UTC deadline, seller quote with zone and integer cents,
// numeric and coded replies, STOP, HELP and DONE.
// Rejects stale bare 1 after a quote changes rather than selecting the latest revision.

import type { MarketState } from '../domain/types.js'
import { findItem, UNIT_PATTERN } from '../domain/catalog.js'
import type { Command as DomainCommand } from '../domain/commands.js'
import { parseReply, type Command as ParsedCommand } from './grammar.js'
import { resolveTarget } from '../app/resolve-target.js'

// ---------------------------------------------------------------------------
// Hour disambiguation
// ---------------------------------------------------------------------------

/**
 * Resolve a bare (no am/pm suffix) hour integer to a 24-hour value using the
 * market clock.
 *
 * Rules (applied in order):
 *   1–7   → afternoon  (hour + 12)   – same as server.ts unqualified rule
 *   10–12 → as-is                    – unambiguously morning/noon
 *   8–9   before 12:00 UTC → as-is   – morning is still ahead
 *   8–9   at/after 12:00 UTC → hour + 12  – 08:xx/09:xx is past; must be evening
 */
export function disambiguateHour(hour: number, nowAt: Date): number {
  // Claude fix (22 Nov): 24-hour times ("before 18:00", "by 16") are already unambiguous.
  if (hour === 0 || (hour >= 13 && hour <= 23)) return hour
  if (hour > 23) return Number.NaN
  if (hour >= 1 && hour <= 7) return hour + 12
  if (hour >= 10 && hour <= 12) return hour
  // hour is 8 or 9
  return nowAt.getUTCHours() >= 12 ? hour + 12 : hour
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

type ExplicitRevisionCommand = { kind: 'accept'; offerRef: number; code: string; explicitRevision: number }

/**
 * Parse explicit revision format: "1 E7 V2" (anchored, case-insensitive)
 * Returns null if not matching.
 */
function parseExplicitRevision(input: string): ExplicitRevisionCommand | null {
  const trimmed = input.trim()
  // Anchored pattern: positive int, E-code, V, positive revision
  const match = /^(\d+)\s+(E\d+)\s+V(\d+)$/i.exec(trimmed)
  if (!match) return null
  const offerRef = parseInt(match[1], 10)
  const code = match[2].toUpperCase()
  const explicitRevision = parseInt(match[3], 10)
  if (explicitRevision < 1) return null
  return { kind: 'accept', offerRef, code, explicitRevision }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Interpret an inbound SMS and produce a domain command.
 * Returns null if the message doesn't match any command pattern or is invalid.
 */
export function interpret(message: string, state: MarketState, senderId: string): DomainCommand | null {
  const trimmed = message.trim()
  const upper = trimmed.toUpperCase()

  // STOP is a valid DomainCommand
  if (upper === 'STOP') {
    return { kind: 'stop', by: senderId }
  }

  // HELP, CANCEL, WIDEN are not DomainCommands - return null for rule-interpreter to reject
  if (upper === 'HELP' || upper === 'CANCEL' || upper === 'WIDEN') {
    return null
  }

  // DONE / done o / DONE. for collect
  if (upper === 'DONE' || upper === 'DONE O') {
    // Collect requires a specific request to be identified.
    // We need the latest held request for this trader.
    const heldRequest = findLatestHeldRequest(state, senderId)
    if (!heldRequest) return null
    return { kind: 'collect', by: senderId, requestCode: heldRequest.code }
  }

  // First: check for explicit revision format (1 E7 V2) - must be before parseReply
  const explicitParsed = parseExplicitRevision(message)
  if (explicitParsed) {
    // Validate the request belongs to sender
    const request = state.requests.get(explicitParsed.code)
    if (!request || request.requesterId !== senderId) return null
    // Validate request is open/active
    if (request.state !== 'open_local' && request.state !== 'widened') return null
    // Validate the offer exists with that exact revision
    const offer = [...state.offers.values()].find(o => o.requestCode === explicitParsed.code && o.replyRef === String(explicitParsed.offerRef) && o.state === 'proposed')
    if (!offer || offer.revision !== explicitParsed.explicitRevision) return null
    // Return accept with exact revision entered
    return {
      kind: 'accept',
      by: senderId,
      requestCode: explicitParsed.code,
      offerRef: String(explicitParsed.offerRef),
      offerRevision: explicitParsed.explicitRevision,
    }
  }

  // Parse reply-style commands (numeric offers)
  const parsed = parseReply(message)
  if (!parsed) return null

  switch (parsed.kind) {
    case 'accept':
      return resolveAcceptCommand(state, senderId, parsed)
    case 'collect':
      return resolveCollectCommand(state, senderId, parsed)
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Command resolution helpers
// ---------------------------------------------------------------------------

function findLatestHeldRequest(state: MarketState, requesterId: string): { code: string } | null {
  // Find requests where this trader is the requester and the state is held
  for (const [code, req] of state.requests) {
    if (req.requesterId === requesterId && req.state === 'held') {
      return { code }
    }
  }
  return null
}

function resolveCollectCommand(state: MarketState, senderId: string, parsed: Extract<ParsedCommand, { kind: 'collect' }>): DomainCommand | null {
  const heldRequest = findLatestHeldRequest(state, senderId)
  if (!heldRequest) return null
  return { kind: 'collect', by: senderId, requestCode: heldRequest.code }
}

function resolveAcceptCommand(state: MarketState, senderId: string, parsed: Extract<ParsedCommand, { kind: 'accept' }>): DomainCommand | null {
  // Find the requester's open/active request(s)
  const activeRequests = [...state.requests.values()].filter(
    r => r.requesterId === senderId && (r.state === 'open_local' || r.state === 'widened'),
  )

  if (activeRequests.length === 0) {
    return null // No active request to accept against
  }

  // If explicit code provided, use that request directly
  let request
  if (parsed.code) {
    const found = activeRequests.find(r => r.code === parsed.code)
    if (!found) return null
    request = found
  } else {
    // No explicit code: require exactly one open request
    if (activeRequests.length > 1) {
      return null // Need code disambiguation
    }
    request = activeRequests[0]
  }

  // Try to resolve to a specific offer using the parsed reference
  const target = resolveTarget(state, request.code, senderId, {
    offerRef: parsed.offerRef,
    code: parsed.code,
  })

  if (!target || !target.offer) return null

  // Reject stale revision: if the offer was revised and no explicit revision was given, reject
  if (target.stale) {
    return null // Will be handled by rule-interpreter with 'stale_revision'
  }

  // Additional safety: reject unversioned reply if target offer revision > 1
  if (target.offer.revision > 1) {
    return null
  }

  return {
    kind: 'accept',
    by: senderId,
    requestCode: request.code,
    offerRef: String(parsed.offerRef),
    offerRevision: target.offer.revision,
  }
}

// ---------------------------------------------------------------------------
// Helper to create seller quote command from message
// ---------------------------------------------------------------------------

/**
 * Parse a seller quote message into an offer command.
 * Expected format: "E7 4200 pickup-zone" or similar variations.
 * - Request code (E7)
 * - Price in integer cents (420000 for 4200 credits)
 * - Pickup zone (generic location)
 */
export function parseSellerQuote(message: string, senderId: string): DomainCommand | null {
  const trimmed = message.trim()
  const parts = trimmed.split(/\s+/)

  if (parts.length < 3) return null

  const requestCode = parts[0].toUpperCase()
  if (!/^E\d+$/.test(requestCode)) return null

  // Claude fix (22 Nov): accept how traders write prices: 4,300 / $4200 / €4200 / 4.5k.
  // A leading currency sign is dropped: credits are the only unit the market keeps.
  let pricePart = parts[1].replace(/^(?:[$€£¥₹₦₱₩₺₽R]|USD|EUR|GBP|INR|KES|NGN|BRL|MXN|ZAR)/i, '').replace(/,(?=\d{3}(?:,|$))/g, '')
  // "4.5k" and "4k" mean thousands.
  const kilo = /^(\d+(?:\.\d{1,3})?)k$/i.exec(pricePart)
  if (kilo) pricePart = String(Math.round(Number(kilo[1]) * 1000))
  const priceMatch = pricePart.match(/^(\d+)$/)
  if (!priceMatch) return null
  const priceInput = parseInt(priceMatch[1], 10)
  // "E10 2 4200 Cedar Lane": a quantity before the price would make the price 2. Ask instead.
  if (/^\d[\d,]*$/.test(parts[2])) return null

  // Validate price as whole credits (1..1,000,000). Reject zero/negative/absurd values.
  if (!Number.isSafeInteger(priceInput) || priceInput < 1 || priceInput > 1000000) return null

  // Convert whole credits to cents (×100)
  const priceCents = priceInput * 100

  const pickupArea = parts.slice(2).join(' ')

  return {
    kind: 'offer',
    by: senderId,
    requestCode,
    priceCents,
    pickupArea,
  }
}

// ---------------------------------------------------------------------------
// Create request command parser (buyer side)
// ---------------------------------------------------------------------------

/**
 * Parse a create-request message.
 * Expected format: "1 sack flour before 6pm" or similar.
 *
 * @param nowAt - Reference time for hour disambiguation (defaults to wall clock).
 *   Pass the market clock time so that bare hours 8 and 9 resolve correctly when
 *   sent after midday (see disambiguateHour).
 */
export function parseCreateRequest(message: string, senderId: string, nowAt?: Date): DomainCommand | null {
  const trimmed = message.trim().toLowerCase()

  // Quantity: a number followed by any unit word ("1 sack", "2 trays", "1 cylinder").
  const qtyMatch = trimmed.match(new RegExp(`\\b(\\d+)\\s+${UNIT_PATTERN.source}`, 'i'))
  if (!qtyMatch) return null
  const quantity = parseInt(qtyMatch[1], 10)

  // Item: the catalogue decides the unit and grade. An unknown item keeps its first word after
  // the unit so the server can tell the trader which items are supported.
  const found = findItem(trimmed)
  const after = trimmed.slice((qtyMatch.index ?? 0) + qtyMatch[0].length).trim().split(/\s+/)
  const name = found?.name ?? (after.find(w => w && w !== 'of') ?? 'unknown')
  const grade = found?.grade ?? 'standard'
  const unit = found?.unit ?? 'unit'

  // Try to extract cutoff time (anchored UTC)
  const timeMatch = trimmed.match(/\b(before|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!timeMatch) return null

  const hour = parseInt(timeMatch[2], 10)
  const minute = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0
  const ampm = timeMatch[4]?.toLowerCase()

  // Resolve hour to 24-hour value.
  // Explicit am/pm takes precedence; bare hours use the clock-aware rule.
  const now = nowAt ?? new Date()
  let hour24: number
  if (ampm === 'am') {
    hour24 = hour === 12 ? 0 : hour
  } else if (ampm === 'pm') {
    hour24 = hour === 12 ? 12 : hour + 12
  } else {
    hour24 = disambiguateHour(hour, now)
  }

  // Build cutoff against today's UTC date
  const cutoff = new Date(now.toISOString().slice(0, 10) + `T${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00Z`)

  // If the time has passed today, use tomorrow
  if (cutoff <= now) {
    cutoff.setUTCDate(cutoff.getUTCDate() + 1)
  }

  return {
    kind: 'create_request',
    by: senderId,
    item: { name, grade, unit },
    quantity,
    cutoffAt: cutoff,
  }
}
