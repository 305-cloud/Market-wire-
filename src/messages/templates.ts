// src/messages/templates.ts
// All outbound message templates.
// Every template must render within 160 GSM-7 characters with the sample data.
// Circle-wide templates must contain no price, phone number or customer note.
// Prices are shown as plain credits: most currency signs (₦, ₹, ₱) are not GSM-7 and would force UCS-2.

import { plainUnits } from '../domain/catalog.js'

export type TemplateId =
  | 'request_confirmed'
  | 'seller_invited'
  | 'offer_received'
  | 'offer_accepted_buyer'
  | 'offer_accepted_seller'
  | 'wrong_pickup_code'
  | 'nothing_held'
  | 'already_widened'
  | 'pickup_locked'
  | 'shortage_alert'
  | 'offer_released_accepted_other'
  | 'offer_released_crate_taken'
  | 'offer_released_cancelled'
  | 'offer_released_expired'
  | 'request_collected_buyer'
  | 'request_collected_seller'
  | 'request_widened_coordinator'
  | 'request_routed_seller'
  | 'request_cancelled_buyer'
  | 'request_cancelled_seller'
  | 'request_expired_buyer'
  | 'hold_expired_buyer'
  | 'hold_expired_seller'
  | 'fallback_buyer'
  | 'stop_confirmed'
  | 'start_confirmed'
  | 'stopped_invitations_paused'
  | 'which_one'
  | 'request_closed'
  | 'help'
  | 'directions_after_accept'
  | 'ambiguous_code'
  | 'stale_revision'

export type TemplateVars = Record<string, string | number>

const templates: Record<TemplateId, (v: TemplateVars) => string> = {
  request_confirmed: v =>
    `${v.code}: your request for ${v.qty} ${v.unit} ${v.name} is open till ${v.cutoff}. Reply CANCEL to close.`,

  seller_invited: v =>
    `${v.code}: spare ${v.qty} ${v.unit ?? 'unit'} ${v.name} needed by ${v.cutoff}. To offer, reply ${v.code}, your price for 1 ${v.unit ?? 'unit'}, then the pickup place.`,

  offer_received: v => {
    const full = `${v.code}: ${v.sellerAlias} offers 1 ${v.unit} for ${v.priceDisplay} credits, ${v.area}, hold till ${v.cutoff}. Reply ${v.ref} to hold.`
    const quote = gsmSeptetCount(plainUnits(full)) <= 160 ? full
      : `${v.code}: ${v.sellerAlias}, ${v.priceDisplay} credits, ${v.area}, till ${v.cutoff}. Hold: ${v.ref}.`
    const withRecord = v.record ? `${quote} ${v.sellerAlias}: ${v.record}.` : quote
    const base = gsmSeptetCount(plainUnits(withRecord)) <= 160 ? withRecord : quote
    const withBand = v.bandLine ? base + '\n' + v.bandLine : base
    return gsmSeptetCount(plainUnits(withBand)) <= 160 ? withBand : base
  },

  offer_accepted_buyer: v =>
    `${v.code}: held with ${v.sellerAlias} till ${v.cutoff}. Reply DONE when you collect.${v.pickupCode ? ' Pickup code ' + v.pickupCode + '.' : ''}`,

  offer_accepted_seller: v =>
    v.askCode
      ? `${v.code}: ${v.buyerAlias} holds your offer till ${v.cutoff}. Buyer record: ${v.record}. At pickup, ask for their 3-digit code and reply GIVEN, the code, then ${v.code}.`
      :
    `${v.code}: your stock is held for the buyer till ${v.cutoff}. Reply when ready.`,

  offer_released_accepted_other: v =>
    `${v.code}: the buyer chose another offer. Your stock is free.`,

  offer_released_crate_taken: v =>
    `${v.code}: that stock was taken by another buyer. Keep looking.`,

  offer_released_cancelled: v =>
    `${v.code}: request cancelled. Your stock is available again.`,

  offer_released_expired: v =>
    `${v.code}: request closed. Your stock is available again.`,

  request_collected_buyer: v =>
    `${v.code}: collected. Receipt: ${v.unit ?? 'unit'} of ${v.name} from ${v.sellerAlias}. Done.`,

  request_collected_seller: v =>
    `${v.code}: collection confirmed. Thank you.`,

  request_widened_coordinator: v =>
    `${v.code}: buyer asks for 1 ${v.unit ?? 'unit'} ${v.name}, ${v.area}, needed by ${v.cutoff}. Route it to a neighbouring circle from the desk.`,

  request_routed_seller: v =>
    `${v.code}: spare ${v.unit ?? 'unit'} of ${v.name} needed by ${v.cutoff} in a nearby circle. To offer, reply ${v.code}, your price for 1 ${v.unit ?? 'unit'}, then the pickup place.`,

  request_cancelled_buyer: v =>
    `${v.code}: cancelled.`,

  request_cancelled_seller: v =>
    `${v.code}: request cancelled. Your stock is available.`,

  request_expired_buyer: v =>
    `${v.code}: time is up. Call your usual contacts.`,

  hold_expired_buyer: v =>
    `${v.code}: your hold ended at the deadline with no pickup, and the request closed. Send a new NEED to try again.`,

  hold_expired_seller: v =>
    `${v.code}: the hold ended at the deadline with no pickup. Your stock is free again.`,

  fallback_buyer: v =>
    `${v.code}: nothing held yet. Call your usual contacts too. Time left: ${v.timeLeft}. ${v.widened ? 'Reply CANCEL ' + v.code + ' to stop.' : 'Reply WIDEN or CANCEL.'}`,

  stop_confirmed: _v =>
    `Invitations paused. Reply START to resume. Active holds are unaffected.`,

  start_confirmed: () => 'Invitations resumed.',

  stopped_invitations_paused: _v =>
    `You have opted out. No invitations will be sent. Reply START to resume.`,

  which_one: v =>
    `Reply ${v.refs} to pick which request you mean, or reply the full code e.g. ${v.example}.`,

  request_closed: _v =>
    `This request is closed. No further changes are possible.`,

  help: v =>
    `${v.code}: reply ${v.options}.`,

  directions_after_accept: v =>
    `${v.code}: pickup at ${v.exactAddress}. Contact: ${v.contact}.`,

  ambiguous_code: v =>
    `You have ${v.count} open requests. Reply with the code, e.g. WIDEN ${v.example}.`,

  stale_revision: v =>
    `${v.code}: that offer changed. The current offer is ${v.ref}. Reply ${v.ref} to hold, or wait for more.`,

  nothing_held: v => `${v.code}: nothing is held yet. Reply an offer number to hold it first.`,

  already_widened: v => `${v.code} is already with the coordinator. Offers still come to you. Reply CANCEL ${v.code} to stop.`,

  wrong_pickup_code: v => `That code doesn't match ${v.code}. Ask the buyer to read their pickup code again.`,

  pickup_locked: v => `${v.code}: too many wrong codes. Ask the buyer to reply DONE ${v.code} when they have the stock.`,

  shortage_alert: v => `${v.item}, ${v.circle}: ${v.asked} asked, ${v.filled} filled in 2h.`,
}

export function renderTemplate(id: TemplateId, vars: TemplateVars): string {
  const fn = templates[id]
  if (!fn) throw new Error(`Unknown template: ${id}`)
  const result = fn(vars)
  // Show internal unit keys ("sack25kg") as plain words ("sack")
  return plainUnits(result)
}

/** Count GSM-7 septets for a string (approximation: treat extension chars as 2). */
export function gsmSeptetCount(s: string): number {
  // Basic GSM-7 charset (excluding extension table entries)
  const basic = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà')
  // Extension chars (count 2 each): | ^ { } [ ] ~ \ €
  const extension = new Set('|^{}[]~\\€')
  let count = 0
  let ucs2 = false
  for (const ch of s) {
    if (extension.has(ch)) count += 2
    else if (basic.has(ch)) count += 1
    else { ucs2 = true; count += 1 }
  }
  // Claude fix (22 Nov): any non-GSM character makes the whole SMS UCS-2, limited to 70 characters.
  // Scale so that the existing 160 limits mean 70 characters in that case.
  return ucs2 ? Math.ceil([...s].length * 160 / 70) : count
}
