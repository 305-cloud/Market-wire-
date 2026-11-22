// src/messages/templates.ts
// All outbound message templates.
// Every template must render within 160 GSM-7 characters with the sample data.
// Circle-wide templates must contain no price, phone number or customer note.
// Use NGN (ASCII) not ₦ (non-GSM7) in SMS bodies.

export type TemplateId =
  | 'request_confirmed'
  | 'seller_invited'
  | 'offer_received'
  | 'offer_accepted_buyer'
  | 'offer_accepted_seller'
  | 'wrong_pickup_code'
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
    `${v.code}: spare ${v.qty} crate ${v.name} needed by ${v.cutoff}. Reply ${v.code} price area.`,

  offer_received: v => {
    const full = `${v.code}: ${v.sellerAlias} offers ${v.qty} ${v.unit}, ${v.priceDisplay} credits, ${v.area}, hold till ${v.cutoff}. Reply ${v.ref} to hold.`
    const quote = gsmSeptetCount(full.replace(/crate30/g, 'crate')) <= 160 ? full
      : `${v.code}: ${v.sellerAlias}, ${v.priceDisplay} credits, ${v.area}, till ${v.cutoff}. Hold: ${v.ref}.`
    const withRecord = v.record ? `${quote} ${v.sellerAlias}: ${v.record}.` : quote
    const base = gsmSeptetCount(withRecord.replace(/crate30/g, 'crate')) <= 160 ? withRecord : quote
    const withBand = v.bandLine ? base + '\n' + v.bandLine : base
    return gsmSeptetCount(withBand.replace(/crate30/g, 'crate')) <= 160 ? withBand : base
  },

  offer_accepted_buyer: v =>
    `${v.code}: held with ${v.sellerAlias} till ${v.cutoff}. Reply DONE when you collect.${v.pickupCode ? ' Pickup code ' + v.pickupCode + '.' : ''}`,

  offer_accepted_seller: v =>
    v.pickupCode
      ? `${v.code}: ${v.buyerAlias} holds your crate till ${v.cutoff}. Buyer record: ${v.record}. Reply GIVEN ${v.pickupCode} ${v.code} at pickup.`
      :
    `${v.code}: your crate is held for the buyer till ${v.cutoff}. Reply when ready.`,

  offer_released_accepted_other: v =>
    `${v.code}: offer not taken. Crate free. Reply ${v.code} price area for new request.`,

  offer_released_crate_taken: v =>
    `${v.code}: that crate was taken by another buyer. Keep looking.`,

  offer_released_cancelled: v =>
    `${v.code}: request cancelled. Your crate is available again.`,

  offer_released_expired: v =>
    `${v.code}: request closed. Your crate is available again.`,

  request_collected_buyer: v =>
    `${v.code}: collected. Receipt: crate ${v.name} from ${v.sellerAlias}. Done.`,

  request_collected_seller: v =>
    `${v.code}: collection confirmed. Thank you.`,

  request_widened_coordinator: v =>
    `${v.code}: crate ${v.name}, ${v.area}, needed by ${v.cutoff}. Reply ROUTE ${v.code} <circle> to dispatch.`,

  request_routed_seller: v =>
    `${v.code}: spare crate ${v.name} needed by ${v.cutoff}. Reply ${v.code} price area.`,

  request_cancelled_buyer: v =>
    `${v.code}: cancelled.`,

  request_cancelled_seller: v =>
    `${v.code}: request cancelled. Your crate is available.`,

  request_expired_buyer: v =>
    `${v.code}: time is up. Call your usual contacts.`,

  hold_expired_buyer: v =>
    `${v.code}: your hold expired. Reply WIDEN to ask the coordinator, or CANCEL.`,

  hold_expired_seller: v =>
    `${v.code}: the buyer's hold expired. Your crate is free again.`,

  fallback_buyer: v =>
    `${v.code}: no offer secured. Call your usual contacts. Time left: ${v.timeLeft}. Reply WIDEN or CANCEL.`,

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

  wrong_pickup_code: v => `That code doesn't match ${v.code}.`,

  shortage_alert: v => `${v.item}, ${v.circle}: ${v.asked} asked, ${v.filled} filled in 2h.`,
}

export function renderTemplate(id: TemplateId, vars: TemplateVars): string {
  const fn = templates[id]
  if (!fn) throw new Error(`Unknown template: ${id}`)
  const result = fn(vars)
  // Normalize internal unit "crate30" to "crate" for user-facing copy
  return result.replace(/crate30/g, 'crate')
}

/** Count GSM-7 septets for a string (approximation: treat extension chars as 2). */
export function gsmSeptetCount(s: string): number {
  // Basic GSM-7 charset (excluding extension table entries)
  const basic = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà')
  // Extension chars (count 2 each): | ^ { } [ ] ~ \ €
  const extension = new Set('|^{}[]~\\€')
  let count = 0
  for (const ch of s) {
    if (extension.has(ch)) count += 2
    else count += 1
  }
  return count
}
