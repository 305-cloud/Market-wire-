// src/http/server.ts
// In-process demo simulator.  Uses PostgreSQL for durability when DATABASE_URL is set,
// otherwise falls back to pure in-memory mode.

import { randomInt, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import { z } from 'zod'

import type { DomainEvent } from '../domain/events.js'
import type { TraderId, RequestCode, MarketState } from '../domain/types.js'
import { emptyMarketState } from '../domain/types.js'
import { decide } from '../domain/decide.js'
import type { OutboundIntent } from '../domain/decide.js'
import { evolve } from '../domain/evolve.js'
import { shortageSummary } from '../domain/shortage.js'
import { interpret, parseSellerQuote, parseCreateRequest, disambiguateHour } from '../parser/interpret.js'
import { parseGiven } from '../parser/grammar.js'
import { renderTemplate } from '../messages/templates.js'
import { gsmSeptetCount } from '../messages/templates.js'
import {
  initPersistence,
  closePersistence,
  saveSnapshot,
  loadRecentSnapshots,
  deleteSnapshot,
  expireOldSnapshots,
  verifyTokenHash,
  isPersistenceEnabled,
} from './demo-persistence.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OutboxMessage {
  to: 'mobile' | 'desktop' | 'room'
  from: string
  text: string
  recipient?: string
  sender?: string
  sent?: boolean
}

export interface Market {
  id: string
  token: string
  baseTime: Date                  // per-market simulated clock
  createdAtMs: number             // real wall-clock ms when this market was created
  events: DomainEvent[]
  messages: OutboxMessage[]
  dedupe: Set<string>
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const inboundBodySchema = z.object({
  alias:             z.string().min(1).max(64),
  text:              z.string().min(1).max(640),
  providerMessageId: z.string().min(1).max(128),
})

// ---------------------------------------------------------------------------
// Static trader / circle identifiers for the demo workspace
// ---------------------------------------------------------------------------

const LOCAL_CIRCLE  = 'circle_local'
const NORTH_CIRCLE  = 'circle_north'

// Keep a canonical alias→traderId mapping (lowercase alias → id)
const ALIAS_TO_ID: Record<string, TraderId> = {
  mara:        'trader_mara',
  ellis:       'trader_ellis',
  jules:       'trader_jules',
  rowan:       'trader_rowan',
  coordinator: 'trader_coord',
}

// Reverse lookup for outbound display
const ID_TO_ALIAS: Record<TraderId, string> = Object.fromEntries(
  Object.entries(ALIAS_TO_ID).map(([k, v]) => [v, k]),
)

// Which circle each trader lives in
const TRADER_CIRCLES: Record<TraderId, string> = {
  trader_mara:   LOCAL_CIRCLE,
  trader_ellis:  LOCAL_CIRCLE,
  trader_jules:  LOCAL_CIRCLE,
  trader_rowan:  NORTH_CIRCLE,
  trader_coord:  NORTH_CIRCLE,   // coordinator belongs to the north circle
}

const TRADER_ROLES: Record<TraderId, 'trader' | 'coordinator'> = {
  trader_mara:   'trader',
  trader_ellis:  'trader',
  trader_jules:  'trader',
  trader_rowan:  'trader',
  trader_coord:  'coordinator',
}

const TRADER_ALIASES: Record<TraderId, string> = {
  trader_mara:   'Mara',
  trader_ellis:  'Ellis',
  trader_jules:  'Jules',
  trader_rowan:  'Rowan',
  trader_coord:  'Coordinator',
}

// ---------------------------------------------------------------------------
// Market store (hybrid in-memory / persistence)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildState(market: Market): MarketState {
  // Seed nextRequestNumber to 7 so the first request gets code E7
  let state = { ...emptyMarketState(market.id), nextRequestNumber: 7 }
  for (const ev of market.events) state = evolve(state, ev)
  return state
}

async function requireBearer(req: FastifyRequest, market: Market): Promise<boolean> {
  const auth = req.headers.authorization ?? ''
  if (isPersistenceEnabled()) {
    const token = auth.replace(/^Bearer\s+/i, '')
    return verifyTokenHash(market.id, token)
  }
  return auth === `Bearer ${market.token}`
}

/** Map outbound-intent recipient to desktop|mobile|room for the UI. */
function routeMessage(traderId: TraderId): OutboxMessage['to'] {
  if (traderId === ALIAS_TO_ID.coordinator) return 'room'
  return traderId === ALIAS_TO_ID.mara ? 'mobile' : 'desktop'
}

function flushOutbound(
  market: Market,
  outbound: OutboundIntent[],
  _state: MarketState,
): void {
  for (const intent of outbound) {
    if (market.dedupe.has(intent.dedupeKey)) continue
    market.dedupe.add(intent.dedupeKey)
    const recipient = ID_TO_ALIAS[intent.to] ?? intent.to
    const sender = intent.template === 'offer_received' ? String(intent.vars.sellerAlias) : 'Market Wire'
    market.messages.push({ to: routeMessage(intent.to), from: recipient, recipient, sender, text: intent.body })
  }
}

/**
 * Claude fix (22 Nov): a rejection is a reply to one specific inbound message, which is already
 * deduplicated by providerMessageId. Key its outbound on that id so a second wrong message in the
 * same simulated minute still gets its own reply instead of being suppressed.
 */
function replyTo(outbound: OutboundIntent[], providerMessageId: string): OutboundIntent[] {
  return outbound.map(o => ({ ...o, dedupeKey: `${o.dedupeKey}#${providerMessageId}` }))
}

// ---------------------------------------------------------------------------
// Claude fix (22 Nov): role-specific help and plain fallback replies, so no text goes unanswered.
// ---------------------------------------------------------------------------
const BUYER_HELP = 'To ask: NEED 1 CRATE EGGS BEFORE 5PM. Reply an offer number to hold, DONE when collected, WIDEN to ask the coordinator, CANCEL to stop.'
const SELLER_HELP = 'To offer: E7 4200 Cedar Lane (request code, your price, pickup place). At pickup: GIVEN and the buyer\'s code, e.g. GIVEN 123 E7. PAUSE stops invites.'

function isSellerNow(state: MarketState, traderId: TraderId): boolean {
  const ownOpen = [...state.requests.values()].some(r => r.requesterId === traderId &&
    (r.state === 'open_local' || r.state === 'widened' || r.state === 'held'))
  const invited = [...state.requests.values()].some(r => r.requesterId !== traderId &&
    r.invitedSellerIds.includes(traderId) && (r.state === 'open_local' || r.state === 'widened' || r.state === 'held'))
  return invited && !ownOpen
}

function roleHelp(state: MarketState, traderId: TraderId): string {
  return isSellerNow(state, traderId) ? SELLER_HELP : BUYER_HELP
}

function fallbackReply(state: MarketState, traderId: TraderId, why: string): string {
  if (why.startsWith('no wideneable')) return 'You have no open request to widen. To ask for stock: NEED 1 CRATE EGGS BEFORE 5PM.'
  if (why.startsWith('no cancellable')) return 'You have no open request to cancel. Offers you made end when the buyer holds another or the request closes.'
  if (why.startsWith('cutoff time missing')) return 'Add a time, e.g. NEED 1 CRATE EGGS BEFORE 5PM or BEFORE 18:00.'
  if (why.startsWith('cutoff time already')) return 'That time has passed or was not clear. Send a later time, e.g. BEFORE 5PM or BEFORE 18:00.'
  if (why === 'unknown_request') return 'That request code was not found. Check the code at the start of the text you got.'
  if (why === 'closed') return renderTemplate('request_closed', {})
  if (why === 'not_member') return 'That request was not sent to you, so you cannot offer or confirm on it.'
  if (why === 'not_requester') return 'Only the buyer who asked can do that.'
  if (why === 'taken') return 'That crate is already held by someone else.'
  if (why === 'stopped') return 'Invitations are paused for you. Reply START to resume.'
  return roleHelp(state, traderId)
}

/** Persist market state after successful mutations. */
async function persistMarket(market: Market): Promise<void> {
  if (isPersistenceEnabled()) {
    await saveSnapshot(market)
  }
}

/**
 * Deliver a plain-text inbox message directly to a trader's UI panel
 * without going through the outbox dedupe path.  Used for system replies
 * (unparseable commands, which-one prompts) that should always appear even
 * when sent in quick succession.
 */
function deliverInbox(
  market: Market,
  traderId: TraderId,
  text: string,
): void {
  market.messages.push({
    to: routeMessage(traderId), from: 'system', sender: 'Market Wire', recipient: ID_TO_ALIAS[traderId], text,
  })
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

function seedMarket(market: Market): void {
  const now = market.baseTime

  // 1. Circles
  const circleCreated1: DomainEvent = { type: 'circle_created', workspaceId: market.id, circleId: LOCAL_CIRCLE, name: 'Local', at: now }
  const circleCreated2: DomainEvent = { type: 'circle_created', workspaceId: market.id, circleId: NORTH_CIRCLE, name: 'North', at: now }
  const circleLinked: DomainEvent   = { type: 'circle_linked',  workspaceId: market.id, circleId: LOCAL_CIRCLE, neighbourId: NORTH_CIRCLE, at: now }
  market.events.push(circleCreated1, circleCreated2, circleLinked)

  // 2. Traders (circles must already be in state before we call decide for create_request)
  for (const [tid, alias] of Object.entries(TRADER_ALIASES)) {
    const ev: DomainEvent = {
      type: 'trader_enrolled',
      workspaceId: market.id,
      traderId: tid,
      alias,
      circleId: TRADER_CIRCLES[tid]!,
      role: TRADER_ROLES[tid]!,
      at: now,
    }
    market.events.push(ev)
  }

  // 3. Seed E7: Mara requests 1 crate medium eggs before 18:00Z
  const cutoff = new Date(now)
  cutoff.setUTCHours(18, 0, 0, 0)
  if (cutoff <= now) cutoff.setUTCDate(cutoff.getUTCDate() + 1)

  const state0 = buildState(market)   // replay circles + traders first

  const cmdCreate = {
    kind: 'create_request' as const,
    by: ALIAS_TO_ID.mara,
    item: { name: 'eggs', grade: 'medium', unit: 'crate30' },
    quantity: 1,
    cutoffAt: cutoff,
  }

  for (const [index, priceKobo] of [410_000, 420_000, 430_000, 440_000, 450_000].entries()) {
    market.events.push({ type: 'demo_trade_seeded', workspaceId: market.id,
      circleId: LOCAL_CIRCLE, item: cmdCreate.item, priceKobo,
      at: new Date(now.getTime() - (index + 2) * 60 * 60_000) })
  }

  const d = decide(state0, cmdCreate, now)
  if (d.ok) {
    for (const ev of d.events) market.events.push(ev)
    // Flush outbound with the post-create state so routing sees traders
    const state1 = buildState(market)
    flushOutbound(market, d.outbound, state1)
  }
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export async function createServer() {
  const markets = new Map<string, Market>()
  const server = Fastify({ logger: false, bodyLimit: 16 * 1024 })

  const __dirname = dirname(fileURLToPath(import.meta.url))
  const webRoot = join(__dirname, '../../web')
  await server.register(fastifyStatic, { root: webRoot, prefix: '/' })

  // Security headers (same-origin; no CORS plugin registered)
  await server.register(fastifyHelmet, { crossOriginResourcePolicy: { policy: 'same-origin' } })

  // Per-IP creation rate limit: max 10 per hour, applied per route via config.rateLimit
  await server.register(fastifyRateLimit, {
    global: false,       // routes opt in via config.rateLimit
    keyGenerator: (req) => req.ip,
  })

  // ---------------------------------------------------------------------------
  // Per-server market cap (max 100 unique markets within any 24-hour window).
  // Keyed by marketId → real wall-clock creation ms.  Map size == live count
  // after sweeping expired entries, so no separate list is needed.
  // ---------------------------------------------------------------------------
  const MARKET_CAP = 100
  const MARKET_WINDOW_MS = 24 * 60 * 60 * 1000

  /** Remove entries older than 24 h and expire stale DB snapshots, then return live count. */
  async function sweepAndCount(): Promise<number> {
    const cutoff = Date.now() - MARKET_WINDOW_MS
    let needsDbExpiry = false
    for (const [id, m] of markets.entries()) {
      if (m.createdAtMs < cutoff) {
        markets.delete(id)
        needsDbExpiry = true
      }
    }
    if (needsDbExpiry && isPersistenceEnabled()) {
      try { await expireOldSnapshots() } catch { /* ignore */ }
    }
    return markets.size
  }

  // Initialize persistence and load recent snapshots
  const persistent = await initPersistence()
  if (persistent) {
    const recent = await loadRecentSnapshots()
    for (const [id, market] of recent) {
      markets.set(id, market)
    }
  }

  // ------------------------------------------------------------------
  // Health
  // ------------------------------------------------------------------
  server.get('/healthz', async () => ({ status: 'ok' }))

  // ------------------------------------------------------------------
  // POST /api/demo/markets  — create a fresh workspace
  // ------------------------------------------------------------------
  server.post<{ Body: { name?: string } }>(
    '/api/demo/markets',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 hour',
        },
      },
    },
    async (req, res) => {
      // Cap: at most MARKET_CAP markets created in the last 24h (sweep expired first)
      await sweepAndCount()
      if (markets.size >= MARKET_CAP) {
        return res.code(429).send({ error: 'global market cap reached; try again later' })
      }

      const id    = `demo_${randomUUID()}`
      const token = `tok_${randomUUID()}`
      const baseTime = new Date('2026-11-20T15:00:00Z')   // 15:00 UTC
      const createdAtMs = Date.now()

      const market: Market = { id, token, baseTime, createdAtMs, events: [], messages: [], dedupe: new Set() }
      seedMarket(market)
      markets.set(id, market)

      // Persist immediately in DB mode
      await persistMarket(market)

      return res.code(201).send({
        marketId:   id,
        token,
        marketName: req.body?.name ?? 'Demo Market',
      })
    },
  )

  // ------------------------------------------------------------------
  // GET /api/demo/markets/:id/state  — poll state (bearer required)
  // ------------------------------------------------------------------
  server.get<{ Params: { id: string } }>(
    '/api/demo/markets/:id/state',
    async (req, res) => {
      await sweepAndCount()
      const market = markets.get(req.params.id)
      if (!market) return res.code(404).send({ error: 'not found' })
      if (!(await requireBearer(req, market))) return res.code(401).send({ error: 'unauthorized' })

      const state = buildState(market)

      return res.send({
        marketId:    market.id,
        currentTime: market.baseTime.toISOString(),
        messages:    market.messages,
        requests:    [...state.requests.values()].map(r => ({
          code:      r.code,
          requester: ID_TO_ALIAS[r.requesterId],
          invitedSellers: r.invitedSellerIds.map(id => ID_TO_ALIAS[id]),
          routed: state.dispatches.has(r.code),
          item:      r.item.name,
          quantity:  r.quantity,
          cutoffAt:  r.cutoffAt.toISOString(),
          state:     r.state,
        })),
        offers:      [...state.offers.values()].filter(o => o.state === 'proposed').map(o => ({
          id:          o.id,
          requestCode: o.requestCode,
          sellerId:    o.sellerId,
          sellerAlias: state.traders.get(o.sellerId)?.alias ?? o.sellerId,
          priceKobo:   o.priceKobo,
          pickupArea:  o.pickupArea,
          ref:         o.replyRef,
          revision:    o.revision,
        })),
        holds:       [...state.holds.values()].map(h => ({
          id:          h.id,
          requestCode: h.requestCode,
          offerId:     h.offerId,
          crateId:     h.crateId,
          state:       h.state,
          heldUntil:   h.heldUntil.toISOString(),
        })),
        crates:      [...state.crates.values()].map(c => ({
          id:       c.id,
          sellerId: c.sellerId,
          item:     c.item,
          state:    c.state,
        })),
      })
    },
  )

  // ------------------------------------------------------------------
  // GET /api/demo/markets/:id/events  — full event log (bearer required)
  // Bug 3: this route was missing; MCP market_events tool requires it.
  // ------------------------------------------------------------------
  server.get<{ Params: { id: string } }>(
    '/api/demo/markets/:id/shortages',
    async (req, res) => {
      await sweepAndCount()
      const market = markets.get(req.params.id)
      if (!market) return res.code(404).send({ error: 'market not found' })
      if (!await requireBearer(req, market)) return res.code(401).send({ error: 'unauthorized' })
      return res.send({ shortages: shortageSummary(buildState(market), market.baseTime) })
    },
  )

  server.get<{ Params: { id: string } }>(
    '/api/demo/markets/:id/events',
    async (req, res) => {
      await sweepAndCount()
      const market = markets.get(req.params.id)
      if (!market) return res.code(404).send({ error: 'not found' })
      if (!(await requireBearer(req, market))) return res.code(401).send({ error: 'unauthorized' })

      return res.send({ marketId: market.id, events: market.events })
    },
  )

  // ------------------------------------------------------------------
  // GET /api/demo/markets/:id/messages  — outbox messages (bearer required)
  // Bug 6 (messages half): MCP market_send needs to inspect delivered messages.
  // ------------------------------------------------------------------
  server.get<{ Params: { id: string } }>(
    '/api/demo/markets/:id/messages',
    async (req, res) => {
      await sweepAndCount()
      const market = markets.get(req.params.id)
      if (!market) return res.code(404).send({ error: 'not found' })
      if (!(await requireBearer(req, market))) return res.code(401).send({ error: 'unauthorized' })

      return res.send({ marketId: market.id, messages: market.messages })
    },
  )

  // ------------------------------------------------------------------
  // POST /api/demo/markets/:id/inbound  — inbound SMS (bearer required)
  // ------------------------------------------------------------------
  server.post<{
    Params: { id: string }
    Body: unknown
  }>(
    '/api/demo/markets/:id/inbound',
    async (req, res) => {
      await sweepAndCount()
      const market = markets.get(req.params.id)
      if (!market) return res.code(404).send({ error: 'not found' })
      if (!(await requireBearer(req, market))) return res.code(401).send({ error: 'unauthorized' })

      // Bug 8: validate body shape with zod before touching anything else
      const parsed = inboundBodySchema.safeParse(req.body)
      if (!parsed.success) {
        return res.code(400).send({ error: 'invalid request body', details: parsed.error.flatten().fieldErrors })
      }
      const { alias, text, providerMessageId } = parsed.data

      // Validate text length (160 GSM-7 chars max)
      if (gsmSeptetCount(text) > 160) {
        return res.code(400).send({ error: 'message too long (max 160 GSM-7 chars)' })
      }

      // Bug E: validate alias BEFORE consuming the idempotency key
      const actor = alias.toLowerCase()
      const traderId = Object.hasOwn(ALIAS_TO_ID, actor) ? ALIAS_TO_ID[actor] : undefined
      if (!traderId) return res.code(400).send({ error: 'unknown alias' })

      // Idempotency (keyed only after alias is confirmed valid)
      const dkey = `provider:${providerMessageId}`
      if (market.dedupe.has(dkey)) {
        return res.send({ status: 'duplicate' })
      }
      market.dedupe.add(dkey)
      market.messages.push({ to: routeMessage(traderId), from: actor, recipient: actor,
        sender: TRADER_ALIASES[traderId], sent: true, text })

      const state = buildState(market)
      const now   = market.baseTime
      // Claude fix (22 Nov): traders write "Done.", "done o", "pause"; normalise before matching commands.
      let upper = text.trim().toUpperCase().replace(/[.!?]+$/, '').trim()
      if (upper === 'DONE O') upper = 'DONE'
      const replyMark = market.messages.length
      // Claude fix (22 Nov): every inbound text gets a reply. If a path rejects without telling the
      // sender anything, send one plain, role-specific reply before answering the HTTP call.
      const guard = async (code: number, body: Record<string, unknown>) => {
        const answered = market.messages.slice(replyMark).some(m => m.recipient === actor && !m.sent)
        if (!answered) {
          deliverInbox(market, traderId, fallbackReply(state, traderId, String(body.error ?? body.reason ?? '')))
          await persistMarket(market)
        }
        return res.code(code).send(body)
      }

      // ----------------------------------------------------------------
      // HELP  — synthesise a help reply to the sender's inbox
      // ----------------------------------------------------------------
      if (upper === 'HELP') {
        const heldReq = [...state.requests.values()].find(
          r => r.requesterId === traderId && r.state === 'held',
        )
        const openReq = [...state.requests.values()].find(
          r => r.requesterId === traderId && (r.state === 'open_local' || r.state === 'widened'),
        )
        const req0 = heldReq ?? openReq
        if (!req0) {
          deliverInbox(market, traderId, roleHelp(state, traderId))
          await persistMarket(market)
          return res.send({ status: 'ok' })
        }
        const code = req0?.code ?? 'E?'
        const options = req0?.state === 'held' ? 'DONE to collect, CANCEL to cancel'
                      : req0?.state === 'open_local' ? 'WIDEN to escalate, CANCEL to cancel'
                      : req0?.state === 'widened'    ? 'CANCEL to cancel'
                      : 'NEED <qty> <item> before <time> to start'
        const body = renderTemplate('help', { code, options })
        deliverInbox(market, traderId, body)
        await persistMarket(market)
        return res.send({ status: 'ok' })
      }

      // ----------------------------------------------------------------
      // WIDEN / WIDEN <code>  — buyer sends; routes via coordinator endpoint
      // ----------------------------------------------------------------
      if (upper === 'WIDEN' || /^WIDEN\s+\S/.test(upper)) {
        // Collect all wideneable requests for this trader
        const widenCandidates = [...state.requests.values()].filter(
          r => r.requesterId === traderId && r.state === 'open_local',
        )

        let requestCode: RequestCode | null = null

        if (/^WIDEN\s+\S/.test(upper)) {
          // Scoped: WIDEN E7 — use the explicit code
          requestCode = upper.split(/\s+/)[1] ?? null
        } else {
          // Bare WIDEN — Bug 6: ask when multiple candidates exist
          if (widenCandidates.length > 1) {
            const opts = widenCandidates.map(r => `WIDEN ${r.code}`).join(' or ')
            const example = `WIDEN ${widenCandidates[0]!.code}`
            deliverInbox(market, traderId, renderTemplate('which_one', { refs: opts, example }))
            await persistMarket(market)
            return guard(400, { error: 'ambiguous: ' + opts })
          }
          requestCode = widenCandidates[0]?.code ?? null
        }

        if (!requestCode) return guard(400, { error: 'no wideneable request' })

        const cmd = { kind: 'widen' as const, by: traderId, requestCode }
        const d   = decide(state, cmd, now)
        // Bug 4: flush rejection outbound regardless of ok/!ok
        if (!d.ok) {
          const state2 = buildState(market)
          flushOutbound(market, replyTo(d.outbound, providerMessageId), state2)
          await persistMarket(market)
          return guard(400, { status: 'rejected', reason: d.reason })
        }
        for (const ev of d.events) market.events.push(ev)
        const state2 = buildState(market)
        flushOutbound(market, d.outbound, state2)
        if (!d.outbound.some(o => o.to === traderId)) {
          deliverInbox(market, traderId, `${requestCode}: sent to the coordinator, who can ask a nearby circle. Offers still come to you. Reply CANCEL ${requestCode} to stop.`)
        }
        await persistMarket(market)
        return res.send({ status: 'ok' })
      }

      // ----------------------------------------------------------------
      // DONE / DONE <code>  — buyer confirms collection
      // ----------------------------------------------------------------
      if (upper === 'DONE' || /^DONE\s+\S/.test(upper)) {
        // Collect all held requests for this trader
        const doneCandidates = [...state.requests.values()].filter(
          r => r.requesterId === traderId && r.state === 'held',
        )

        let requestCode: RequestCode | null = null

        if (/^DONE\s+\S/.test(upper)) {
          // Scoped: DONE E7
          requestCode = upper.split(/\s+/)[1] ?? null
        } else {
          // Bare DONE — Bug 6: ask when multiple candidates exist
          if (doneCandidates.length > 1) {
            const opts = doneCandidates.map(r => `DONE ${r.code}`).join(' or ')
            const example = `DONE ${doneCandidates[0]!.code}`
            deliverInbox(market, traderId, renderTemplate('which_one', { refs: opts, example }))
            await persistMarket(market)
            return guard(400, { error: 'ambiguous: ' + opts })
          }
          requestCode = doneCandidates[0]?.code ?? null
          // Claude fix (22 Nov): if the seller already confirmed, a bare DONE repeats the receipt (I3).
          if (!requestCode) {
            const collected = [...state.requests.values()].filter(
              r => r.requesterId === traderId && r.state === 'collected')
            requestCode = collected.at(-1)?.code ?? null
          }
        }

        if (!requestCode) {
          deliverInbox(market, traderId, 'You have no pickup to confirm. Hold an offer first by replying its number.')
          await persistMarket(market)
          return guard(400, { error: 'no held request' })
        }

        const cmd = { kind: 'collect' as const, by: traderId, requestCode }
        const d   = decide(state, cmd, now)
        // Bug 4: flush rejection outbound
        if (!d.ok) {
          const state2 = buildState(market)
          flushOutbound(market, replyTo(d.outbound, providerMessageId), state2)
          await persistMarket(market)
          return guard(400, { status: 'rejected', reason: d.reason })
        }
        for (const ev of d.events) market.events.push(ev)
        const state2 = buildState(market)
        flushOutbound(market, d.outbound, state2)
        await persistMarket(market)
        return res.send({ status: 'ok' })
      }

      // ----------------------------------------------------------------
      // CANCEL / CANCEL <code> / STOP
      // ----------------------------------------------------------------
      if (upper === 'CANCEL' || /^CANCEL\s+\S/.test(upper)) {
        // Collect all cancellable requests for this trader
        const cancelCandidates = [...state.requests.values()].filter(
          r => r.requesterId === traderId &&
            (r.state === 'open_local' || r.state === 'widened' || r.state === 'held'),
        )

        let requestCode: RequestCode | null = null

        if (/^CANCEL\s+\S/.test(upper)) {
          // Scoped: CANCEL E7
          requestCode = upper.split(/\s+/)[1] ?? null
        } else {
          // Bare CANCEL — Bug 6: ask when multiple candidates exist
          if (cancelCandidates.length > 1) {
            const opts = cancelCandidates.map(r => `CANCEL ${r.code}`).join(' or ')
            const example = `CANCEL ${cancelCandidates[0]!.code}`
            deliverInbox(market, traderId, renderTemplate('which_one', { refs: opts, example }))
            await persistMarket(market)
            return guard(400, { error: 'ambiguous: ' + opts })
          }
          requestCode = cancelCandidates[0]?.code ?? null
        }

        if (!requestCode) return guard(400, { error: 'no cancellable request' })

        const cmd  = { kind: 'cancel' as const, by: traderId, requestCode }
        const d    = decide(state, cmd, now)
        // Bug 4: flush rejection outbound
        if (!d.ok) {
          const state2 = buildState(market)
          flushOutbound(market, replyTo(d.outbound, providerMessageId), state2)
          await persistMarket(market)
          return guard(400, { status: 'rejected', reason: d.reason })
        }
        for (const ev of d.events) market.events.push(ev)
        const state2 = buildState(market)
        flushOutbound(market, d.outbound, state2)
        await persistMarket(market)
        return res.send({ status: 'ok' })
      }

      // ----------------------------------------------------------------
      // Try the standard interpreter first (handles: STOP, 1, 1 E7)
      // ----------------------------------------------------------------
      let cmd = interpret(upper === 'PAUSE' ? 'STOP' : text.trim(), state, traderId)
      if (upper === 'START' || upper === 'RESUME') cmd = { kind: 'start', by: traderId }
      const given = parseGiven(text)
      if (given) {
        const holds = [...state.holds.values()].filter(hold =>
          state.offers.get(hold.offerId)?.sellerId === traderId &&
          (hold.state === 'live' || hold.state === 'collected'))
        const live = holds.filter(hold => hold.state === 'live')
        const candidates = live.length ? live : holds
        if (!given.requestCode && candidates.length !== 1) {
          deliverInbox(market, traderId, candidates.length
            ? 'Add the request code to your reply, for example GIVEN 482 E7.'
            : 'You have no pickup to confirm.')
          await persistMarket(market)
          return guard(400, { error: 'choose a pickup' })
        }
        cmd = { kind: 'collect', by: traderId, requestCode: given.requestCode ?? candidates[0].requestCode,
          pickupCode: given.pickupCode }
      }

      // ----------------------------------------------------------------
      // Seller quote: "E7 4200 Cedar Lane" (format: code amount pickup-area)
      // ----------------------------------------------------------------
      if (!cmd) {
        const sellerCmd = parseSellerQuote(text.trim(), traderId)
        if (sellerCmd && sellerCmd.kind === 'offer') {
          if (gsmSeptetCount(sellerCmd.pickupArea) > 64) {
            deliverInbox(market, traderId, 'Use a shorter pickup area, up to 64 characters, then send the quote again.')
            await persistMarket(market)
            return guard(400, { error: 'pickup area is too long' })
          }
          cmd = sellerCmd
        }
      }

      // ----------------------------------------------------------------
      // Create request: "NEED 1 CRATE EGGS BEFORE 6"
      // ----------------------------------------------------------------
      if (!cmd) {
        const createCmd = parseCreateRequest(text.trim(), traderId)
        if (createCmd && createCmd.kind === 'create_request') {
          // Override cutoff using the market's simulated clock
          // Match anchored BEFORE or BY with time, e.g., "BEFORE 6" or "BY 6:30PM"
          const timeMatch = text.match(/\b(BEFORE|BY)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
          if (!timeMatch) {
            return guard(400, { error: 'cutoff time missing (use BEFORE <time> or BY <time>)' })
          }

          const hourStr = timeMatch[2]
          const minuteStr = timeMatch[3]
          const ampmStr = timeMatch[4]
          const hour = parseInt(hourStr, 10)
          const minute = minuteStr ? parseInt(minuteStr, 10) : 0

          let hour24: number
          const ampm = ampmStr?.toLowerCase()
          if (ampm === 'am' || ampm === 'pm') {
            // Explicit AM/PM — preserve as-is
            hour24 = ampm === 'pm' ? (hour === 12 ? 12 : hour + 12) : (hour === 12 ? 0 : hour)
          } else {
            // Bare hour — delegate to disambiguateHour (clock-aware)
            hour24 = disambiguateHour(hour, now)
          }

          // Build cutoff date in UTC
          const cutoff = new Date(now.toISOString().slice(0, 10) + `T${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00Z`)

          // Reject if cutoff already elapsed
          if (!Number.isFinite(cutoff.getTime()) || cutoff <= now) {
            return guard(400, { error: 'cutoff time already elapsed' })
          }

          if (createCmd.quantity !== 1) {
            deliverInbox(market, traderId, 'Market Wire finds one crate per request for now. Send NEED 1 CRATE EGGS BEFORE 5PM once for each crate you need.')
            await persistMarket(market)
            return guard(400, { error: 'one crate per request' })
          }
          cmd = { ...createCmd, cutoffAt: cutoff }
        }
      }

      // Bug 4 / Bug 8: unrecognised text — send one clear inbox reply, return 400
      if (!cmd) {
        // Claude fix (22 Nov): a repeated hold reply gets a plain answer instead of the generic help text.
        const replyMatch = /^\d+\.?(?:\s+(E\d+))?[.!?]?$/i.exec(text.trim())
        if (replyMatch) {
          const wanted = replyMatch[1]?.toUpperCase()
          const heldByMe = [...state.requests.values()].filter(r => r.requesterId === traderId && r.state === 'held' &&
            (!wanted || r.code === wanted))
          if (heldByMe.length === 1) {
            const code = heldByMe[0]!.code
            deliverInbox(market, traderId, `${code}: you already hold this crate. Reply DONE ${code} when you collect.`)
            await persistMarket(market)
            return guard(400, { status: 'rejected', reason: 'already_held' })
          }
        }
        const quoteLike = /^(E\d+)\b/i.exec(text.trim())
        deliverInbox(market, traderId, quoteLike
          ? `To offer on ${quoteLike[1]!.toUpperCase()}: ${quoteLike[1]!.toUpperCase()} 4200 Cedar Lane (your price for 1 crate, then the pickup place).`
          : roleHelp(state, traderId))
        await persistMarket(market)
        return guard(400, { error: 'unparseable command' })
      }

      if (cmd.kind === 'accept') cmd = { ...cmd, pickupCode: String(randomInt(100, 1000)) }
      const d = decide(state, cmd, now)
      // Bug 4: flush outbound even on rejection
      if (!d.ok) {
        // Claude fix (22 Nov): keep audit events a rejection records, e.g. wrong pickup codes for the lockout.
        for (const ev of d.events ?? []) market.events.push(ev)
        const state2 = buildState(market)
        flushOutbound(market, replyTo(d.outbound, providerMessageId), state2)
        await persistMarket(market)
        return guard(400, { status: 'rejected', reason: d.reason })
      }
      for (const ev of d.events) market.events.push(ev)
      const state2 = buildState(market)
      flushOutbound(market, d.outbound, state2)
      // Claude fix (22 Nov): tell the seller their offer went out.
      if (cmd.kind === 'offer') {
        const credits = (cmd.priceKobo / 100).toLocaleString('en', { maximumFractionDigits: 0 })
        deliverInbox(market, traderId, `${cmd.requestCode}: your offer of ${credits} credits at ${cmd.pickupArea} went to the buyer. To change it, send a new price.`)
      }
      await persistMarket(market)

      return res.send({ status: 'ok' })
    },
  )

  // ------------------------------------------------------------------
  // POST /api/demo/markets/:id/coordinator/route  (bearer required)
  // The coordinator clicks "Route" after WIDEN arrives in the room.
  // Routes the request to the NORTH circle (the neighbouring circle).
  // ------------------------------------------------------------------
  server.post<{ Params: { id: string }; Body: { requestCode: string } }>(
    '/api/demo/markets/:id/coordinator/route',
    async (req, res) => {
      await sweepAndCount()
      const market = markets.get(req.params.id)
      if (!market) return res.code(404).send({ error: 'not found' })
      if (!(await requireBearer(req, market))) return res.code(401).send({ error: 'unauthorized' })

      const requestCode = req.body?.requestCode
      if (!requestCode) return res.code(400).send({ error: 'requestCode required' })

      const state = buildState(market)
      const now   = market.baseTime

      const reqRec = state.requests.get(requestCode)
      if (!reqRec) return res.code(400).send({ error: 'unknown request' })
      if (reqRec.state !== 'widened') return res.code(400).send({ error: 'request not widened' })

      // Route to the north (neighbouring) circle
      const northCircle = state.circles.get(NORTH_CIRCLE)
      if (!northCircle) return res.code(500).send({ error: 'north circle missing' })

      const cmd = {
        kind: 'route' as const,
        by:         ALIAS_TO_ID.coordinator,
        requestCode,
        circleId:   NORTH_CIRCLE,
      }

      const d = decide(state, cmd, now)
      if (!d.ok) return res.code(400).send({ status: 'rejected', reason: d.reason })
      for (const ev of d.events) market.events.push(ev)
      const state2 = buildState(market)
      flushOutbound(market, d.outbound, state2)
      await persistMarket(market)

      return res.send({ status: 'ok' })
    },
  )

  // ------------------------------------------------------------------
  // POST /api/demo/markets/:id/clock  — advance simulated time
  // ------------------------------------------------------------------
  server.post<{ Params: { id: string }; Body: { minutes?: number } }>(
    '/api/demo/markets/:id/clock',
    async (req, res) => {
      await sweepAndCount()
      const market = markets.get(req.params.id)
      if (!market) return res.code(404).send({ error: 'not found' })
      if (!(await requireBearer(req, market))) return res.code(401).send({ error: 'unauthorized' })

      const mins = Number(req.body?.minutes ?? 10)
      if (!Number.isFinite(mins) || mins < 1 || mins > 1440) {
        return res.code(400).send({ error: 'minutes must be 1-1440' })
      }
      market.baseTime = new Date(market.baseTime.getTime() + mins * 60_000)

      // Execute tick to process any time-sensitive state changes
      const tickState = buildState(market)
      const tickDecision = decide(tickState, { kind: 'tick' }, market.baseTime)
      if (tickDecision.ok) {
        for (const ev of tickDecision.events) market.events.push(ev)
        const postTickState = buildState(market)
        flushOutbound(market, tickDecision.outbound, postTickState)
      }

      await persistMarket(market)
      return res.send({ at: market.baseTime.toISOString(), advanceMinutes: mins })
    },
  )

  // ------------------------------------------------------------------
  // POST /api/demo/markets/:id/reset  — wipe and reseed (bearer required)
  // Returns a fresh token so the client must re-auth.
  // ------------------------------------------------------------------
  server.post<{ Params: { id: string } }>(
    '/api/demo/markets/:id/reset',
    async (req, res) => {
      await sweepAndCount()
      const market = markets.get(req.params.id)
      if (!market) return res.code(404).send({ error: 'not found' })
      if (!(await requireBearer(req, market))) return res.code(401).send({ error: 'unauthorized' })

      // Delete old snapshot before reseeding
      if (isPersistenceEnabled()) {
        await deleteSnapshot(market.id)
      }

      const newToken = `tok_${randomUUID()}`
      market.token    = newToken
      market.baseTime = new Date('2026-11-20T15:00:00Z')
      market.events   = []
      market.messages = []
      market.dedupe   = new Set()
      seedMarket(market)

      await persistMarket(market)
      return res.send({ marketId: market.id, token: newToken, status: 'reset' })
    },
  )

  // ------------------------------------------------------------------
  // Cleanup on close
  // ------------------------------------------------------------------
  server.addHook('onClose', async () => {
    await closePersistence()
  })

  return server
}
