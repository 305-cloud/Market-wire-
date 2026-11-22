/**
 * Parse reply messages into structured commands.
 * Supports: numbered offers (1, 1., 1 E7), DONE/done o.
 * STOP, HELP, CANCEL, WIDEN are handled at a higher level in interpret.ts.
 */

export type Command =
  | { kind: 'accept'; offerRef: number; code?: string }
  | { kind: 'collect' }

export function parseGiven(input: string): { pickupCode: string; requestCode?: string } | null {
  const match = /^GIVEN\s+([1-9]\d{2})(?:\s+(E\d+))?[.!?]?$/i.exec(input.trim())
  return match ? { pickupCode: match[1], requestCode: match[2]?.toUpperCase() } : null
}

/**
 * Parse a user reply into a command.
 */
export function parseReply(input: string): Command | null {
  const trimmed = input.trim()

  // Remove trailing punctuation (., !, ?)
  const cleaned = trimmed.replace(/[.!?]+$/, '').trim()

  const upper = cleaned.toUpperCase()

  // DONE / done o / DONE.
  if (upper === 'DONE' || upper === 'DONE O') {
    return { kind: 'collect' }
  }

  // STOP / HELP / CANCEL / WIDEN are handled at higher level in interpret.ts
  if (upper === 'STOP' || upper === 'HELP' || upper === 'CANCEL' || upper === 'WIDEN') {
    return null
  }

  // WIDEN [E#]
  if (upper.startsWith('WIDEN ')) {
    return null
  }

  // Numbered offer: "1", "1.", "1 E7", "1 e7"
  const numberedMatch = cleaned.match(/^(\d+)(?:\.\s*)?(?:\s*(E\d+))?$/i)
  if (numberedMatch) {
    const offerRef = parseInt(numberedMatch[1], 10)
    const code = numberedMatch[2]?.toUpperCase()
    return { kind: 'accept', offerRef, code }
  }

  return null
}
