// Regressions for Claude's 22 Nov review of a552eb3 (bugs 1-4 and the minor items).
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
delete process.env.DATABASE_URL
const { createServer } = await import('../dist/src/http/server.js')
const servers = []
after(async () => { await Promise.all(servers.map(server => server.close())) })

async function market() {
  const server = await createServer()
  servers.push(server)
  const { marketId, token } = (await server.inject({ method: 'POST', url: '/api/demo/markets', payload: {} })).json()
  const auth = { authorization: `Bearer ${token}` }
  const send = async (alias, text) => {
    const res = await server.inject({ method: 'POST', url: `/api/demo/markets/${marketId}/inbound`, headers: auth,
      payload: { alias, text, providerMessageId: randomUUID() } })
    return { code: res.statusCode, body: res.json() }
  }
  const state = async () => (await server.inject({ method: 'GET', url: `/api/demo/markets/${marketId}/state`, headers: auth })).json()
  const clock = async minutes => server.inject({ method: 'POST', url: `/api/demo/markets/${marketId}/clock`, headers: auth, payload: { minutes } })
  const inbox = async who => (await state()).messages.filter(m => m.recipient === who)
  const e7 = async () => (await state()).requests.find(r => r.code === 'E7').state
  const rules = async (withToken = true) => server.inject({ method: 'GET', url: `/api/demo/markets/${marketId}/rules`, headers: withToken ? auth : {} })
  const route = async requestCode => server.inject({ method: 'POST', url: `/api/demo/markets/${marketId}/coordinator/route`, headers: auth, payload: { requestCode } })
  return { send, state, clock, inbox, e7, rules, route }
}
async function held() {
  const m = await market()
  await m.send('ellis', 'E7 4200 Cedar Lane')
  await m.send('mara', '1')
  const code = /Pickup code (\d{3})/.exec((await m.inbox('mara')).at(-1).text)[1]
  return { m, code }
}

test('FIX-1: only the buyer is sent the pickup code', async () => {
  const { m, code } = await held()
  const others = (await m.state()).messages.filter(x => x.recipient !== 'mara')
  assert.ok(others.every(x => !x.text.includes(code)), 'no one but the buyer sees the code')
  assert.match((await m.inbox('ellis')).at(-1).text, /ask for their 3-digit code and reply GIVEN, the code, then E7/)
  assert.ok((await m.inbox('ellis')).at(-1).text.length <= 160)
})

test('FIX-2: GIVEN locks after 5 wrong codes, even for the right code; buyer DONE still works', async () => {
  const { m, code } = await held()
  const wrongs = ['100', '101', '102', '103', '104', '105'].filter(c => c !== code).slice(0, 5)
  for (const w of wrongs) assert.equal((await m.send('ellis', `GIVEN ${w} E7`)).code, 400)
  assert.match((await m.inbox('ellis')).at(-1).text, /too many wrong codes/)
  const r = await m.send('ellis', `GIVEN ${code} E7`)
  assert.equal(r.body.reason, 'pickup_locked')
  assert.equal(await m.e7(), 'held')
  assert.equal((await m.send('mara', 'DONE')).code, 200)
  assert.equal(await m.e7(), 'collected')
})

test('FIX-2b: under 5 wrong codes the right code still works', async () => {
  const { m, code } = await held()
  for (const w of ['100', '101', '102', '103'].filter(c => c !== code).slice(0, 3)) await m.send('ellis', `GIVEN ${w} E7`)
  assert.equal((await m.send('ellis', `GIVEN ${code} E7`)).code, 200)
  assert.equal(await m.e7(), 'collected')
})

test('FIX-3: one shortage alert per circle and item per 120 minutes, across clock-bucket edges', async () => {
  const m = await market()
  for (const who of ['jules', 'jules', 'ellis', 'ellis']) assert.equal((await m.send(who, 'NEED 1 CRATE EGGS BEFORE 5PM')).code, 200)
  const alerts = async () => (await m.inbox('coordinator')).filter(x => /asked/.test(x.text)).length
  await m.clock(50); assert.equal(await alerts(), 1)
  await m.clock(15); assert.equal(await alerts(), 1, 'no repeat at the 16:00 UTC bucket edge')
  await m.clock(40); assert.equal(await alerts(), 1)
})

test('FIX-3b: a shortage that persists past 120 minutes can alert again', async () => {
  const m = await market()
  // Wave 1 closes at 17:00; wave 2 starts after it, so nobody passes the 3-open-request cap.
  for (const who of ['jules', 'ellis', 'jules', 'ellis']) assert.equal((await m.send(who, 'NEED 1 CRATE EGGS BEFORE 5PM')).code, 200)
  await m.clock(10)
  const n1 = (await m.inbox('coordinator')).filter(x => /asked/.test(x.text)).length
  await m.clock(125)
  for (const who of ['jules', 'ellis', 'jules', 'ellis', 'mara']) assert.equal((await m.send(who, 'NEED 1 CRATE EGGS BEFORE 11PM')).code, 200)
  await m.clock(10)
  const n2 = (await m.inbox('coordinator')).filter(x => /asked/.test(x.text)).length
  assert.equal(n1, 1); assert.equal(n2, 2)
})

test('FIX-4: bare DONE after the seller confirmed repeats the receipt; nothing changes', async () => {
  const { m, code } = await held()
  assert.equal((await m.send('ellis', `GIVEN ${code}`)).code, 200)
  const before = (await m.state()).messages.length
  assert.equal((await m.send('mara', 'DONE')).code, 200)
  assert.match((await m.inbox('mara')).at(-1).text, /E7: collected\. Receipt/)
  assert.ok((await m.state()).messages.length > before)
})

test('FIX-4b: DONE with nothing held gets a plain reply, not silence', async () => {
  const m = await market()
  const before = (await m.inbox('mara')).length
  assert.equal((await m.send('mara', 'DONE')).code, 400)
  assert.ok((await m.inbox('mara')).length > before + 1, 'the DONE itself plus one reply')
})

test('MINOR: a repeated "1 E7" after holding says "you already hold"', async () => {
  const { m } = await held()
  const r = await m.send('mara', '1 E7')
  assert.equal(r.body.reason, 'already_held')
  assert.match((await m.inbox('mara')).at(-1).text, /already hold a crate/)
})

// ---- Fixes from the first-use (consumer) review, 22 Nov ----

test('UX: 24-hour times work ("before 18:00")', async () => {
  const m = await market()
  assert.equal((await m.send('jules', 'NEED 1 CRATE EGGS BEFORE 18:00')).code, 200)
  const e8 = (await m.state()).requests.find(r => r.code === 'E8')
  assert.equal(e8.cutoffAt, '2026-11-20T18:00:00.000Z')
})

test('UX: one crate per request, said plainly', async () => {
  const m = await market()
  assert.equal((await m.send('jules', 'NEED 3 CRATES EGGS BEFORE 5PM')).code, 400)
  assert.match((await m.inbox('jules')).at(-1).text, /one crate per request/)
  assert.equal((await m.send('jules', 'need 1 tray eggs before 5pm')).code, 200, 'tray means crate')
})

test('UX: offers say 1 crate and the price; seller is told the offer went out', async () => {
  const m = await market()
  assert.equal((await m.send('ellis', 'E7 4,300 Cedar Lane')).code, 200)
  assert.match((await m.inbox('mara')).at(-1).text, /Ellis offers 1 crate for 4,300 credits/)
  assert.match((await m.inbox('ellis')).at(-1).text, /your offer of 4,300 credits at Cedar Lane went to the buyer/)
  assert.equal((await m.send('jules', 'E7 N4100 Oak Row')).code, 200)
  assert.match((await m.inbox('mara')).at(-1).text, /4,100 credits/)
})

test('UX: a number before the price is not read as the price', async () => {
  const m = await market()
  assert.equal((await m.send('ellis', 'E7 2 4200 Cedar Lane')).code, 400)
  assert.match((await m.inbox('ellis')).at(-1).text, /To offer on E7: E7 4200 Cedar Lane/)
  assert.equal((await m.state()).offers.length, 0)
})

test('UX: with two open requests, offers name the request in the reply', async () => {
  const m = await market()
  await m.send('mara', 'NEED 1 CRATE EGGS BEFORE 5PM')
  await m.send('ellis', 'E8 4200 Cedar Lane')
  assert.match((await m.inbox('mara')).at(-1).text, /Reply 1 E8 to hold/)
})

test('UX: "done o" collects; PAUSE pauses invitations', async () => {
  const { m } = await held()
  assert.equal((await m.send('mara', 'done o')).code, 200)
  assert.equal(await m.e7(), 'collected')
  assert.equal((await m.send('rowan', 'pause')).code, 200)
})

test('UX: sellers get seller help; buyers get buyer help', async () => {
  const m = await market()
  await m.send('ellis', 'help')
  assert.match((await m.inbox('ellis')).at(-1).text, /^To offer:/)
  await m.send('rowan', 'help')
  assert.match((await m.inbox('rowan')).at(-1).text, /^To ask: NEED/)
})

test('UX: widening is confirmed to the buyer', async () => {
  const m = await market()
  assert.equal((await m.send('mara', 'WIDEN')).code, 200)
  assert.match((await m.inbox('mara')).at(-1).text, /sent to the coordinator/)
})

test('UX: every inbound text gets at least one reply to the sender', async () => {
  const m = await market()
  const texts = [['mara', 'widen e99'], ['ellis', 'cancel'], ['jules', 'E99 4000 Oak Row'], ['rowan', 'widen'],
    ['mara', 'need 1 crate eggs'], ['mara', 'need 1 crate eggs before 1am'], ['ellis', 'GIVEN 123'], ['mara', '7'],
    ['jules', 'hello'], ['mara', 'DONE E42'], ['ellis', 'E7 0 Cedar Lane'], ['ellis', 'E7 4200']]
  for (const [who, text] of texts) {
    const before = (await m.inbox(who)).length
    await m.send(who, text)
    const after = await m.inbox(who)
    assert.ok(after.length >= before + 2, `"${text}" from ${who} got no reply`)
    for (const msg of after.slice(before + 1)) assert.ok(msg.text.length <= 160, msg.text)
  }
})

// ---- Fixes from the stress test, 22 Nov ----

test('STRESS: repeated STOP and repeated DONE always get their reply', async () => {
  const m = await market()
  for (const t of ['STOP', 'START', 'STOP', 'STOP']) {
    const before = (await m.inbox('jules')).length
    await m.send('jules', t)
    assert.ok((await m.inbox('jules')).length >= before + 2, `${t} got no reply`)
  }
  const { m: m2 } = await held()
  for (let i = 0; i < 3; i++) {
    await m2.send('mara', 'DONE')
    assert.match((await m2.inbox('mara')).at(-1).text, /E7: collected/)
  }
})

test('STRESS: "Done thanks", "CANCEL PLS", "Stop please" are the command, not a request code', async () => {
  const { m } = await held()
  assert.equal((await m.send('mara', 'Done thanks')).code, 200)
  assert.equal(await m.e7(), 'collected')
  const m2 = await market()
  assert.equal((await m2.send('mara', 'CANCEL PLS')).code, 200)
  assert.equal((await m2.state()).requests[0].state, 'cancelled')
})

test('STRESS: "before 1am" late in the evening means tomorrow; 24-hour times work', async () => {
  const m = await market()
  await m.clock(510) // 23:30
  assert.equal((await m.send('jules', 'NEED 1 CRATE EGGS BEFORE 1AM')).code, 200)
  assert.equal((await m.state()).requests.at(-1).cutoffAt, '2026-11-21T01:00:00.000Z')
})

test('STRESS: free text, zero, huge and unknown items do not create requests', async () => {
  const m = await market()
  for (const t of ['sorry i have 0 crates by 5', 'NEED 0 CRATES EGGS BEFORE 5PM', 'NEED 99999999999999999999999 CRATES EGGS BEFORE 5PM', 'NEED 1 CRATE TOMATOES BEFORE 5PM'])
    assert.equal((await m.send('ellis', t)).code, 400, t)
  assert.equal((await m.state()).requests.length, 1)
})

test('STRESS: the coordinator cannot create requests; a trader keeps at most 3 open', async () => {
  const m = await market()
  assert.equal((await m.send('coordinator', 'NEED 1 CRATE EGGS BEFORE 5PM')).code, 400)
  assert.equal((await m.send('mara', 'NEED 1 CRATE EGGS BEFORE 5PM')).code, 200)
  assert.equal((await m.send('mara', 'NEED 1 CRATE EGGS BEFORE 5PM')).code, 200)
  assert.equal((await m.send('mara', 'NEED 1 CRATE EGGS BEFORE 5PM')).code, 400)
  assert.match((await m.inbox('mara')).at(-1).text, /already have 3 open requests/)
})

test('STRESS: honest replies for DONE before a hold and a second WIDEN', async () => {
  const m = await market()
  await m.send('mara', 'DONE E7')
  assert.match((await m.inbox('mara')).at(-1).text, /nothing is held yet/)
  await m.send('mara', 'WIDEN')
  await m.send('mara', 'WIDEN E7')
  assert.match((await m.inbox('mara')).at(-1).text, /already with the coordinator/)
})

test('STRESS: a revised quote gets the current-offer reply; bare "1" with two open requests asks which', async () => {
  const m = await market()
  await m.send('ellis', 'E7 4200 Cedar Lane'); await m.send('ellis', 'E7 5000 Cedar Lane')
  await m.send('mara', '1')
  assert.match((await m.inbox('mara')).at(-1).text, /that offer changed\. The current offer is 1 E7 v2/)
  await m.send('mara', 'NEED 1 CRATE EGGS BEFORE 5PM')
  await m.send('mara', '1')
  assert.match((await m.inbox('mara')).at(-1).text, /1 E7 or 1 E8/)
})

test('STRESS: the losing seller is told plainly; no stranger learns a request state', async () => {
  const m = await market()
  await m.send('ellis', 'E7 4200 Cedar Lane'); await m.send('jules', 'E7 4100 Oak Row')
  await m.send('mara', '2')
  assert.match((await m.inbox('ellis')).at(-1).text, /the buyer chose another offer\. Your crate is free\./)
  await m.send('rowan', 'E7 4300 North gate')
  assert.match((await m.inbox('rowan')).at(-1).text, /not sent to you/)
})

test('STRESS: no "no crate held" warning one minute after a request is made', async () => {
  const m = await market()
  await m.clock(165)
  await m.send('jules', 'NEED 1 CRATE EGGS BEFORE 6PM')
  await m.clock(1)
  assert.ok(!(await m.inbox('jules')).some(x => /no crate held yet/.test(x.text)))
})

test('STRESS: requests the buyer cancelled do not count towards a shortage alert', async () => {
  const m = await market()
  for (let i = 0; i < 2; i++) for (const who of ['jules', 'ellis']) { await m.send(who, 'NEED 1 CRATE EGGS BEFORE 5PM') }
  for (const [who, code] of [['jules', 'E8'], ['ellis', 'E9'], ['jules', 'E10'], ['ellis', 'E11']]) await m.send(who, `CANCEL ${code}`)
  await m.clock(10)
  assert.equal((await m.inbox('coordinator')).filter(x => /asked/.test(x.text)).length, 0)
})

// Word reader (lexicon) and rules on the wire, 22 Nov.
const { rulesReport } = await import('../dist/src/http/rules-audit.js')
const { emptyMarketState } = await import('../dist/src/domain/types.js')

test('READER: closing a deal always asks first, naming the request; clear requests run', async () => {
  const { m } = await held()
  assert.equal((await m.send('mara', 'i don collect')).body.suggestion, 'DONE E7')
  assert.equal(await m.e7(), 'held')
  for (const t of ['egg don finish', 'hold 1', 'i don reach']) assert.notEqual((await m.send('mara', t)).code, 200, t)
  assert.equal(await m.e7(), 'held')
  assert.equal((await m.send('mara', 'i don collect')).body.suggestion, 'DONE E7')
  assert.equal((await m.send('mara', 'yes')).code, 200)
  assert.equal(await m.e7(), 'collected')
  assert.equal((await m.send('mara', 'abeg i need 1 crate egg b4 6')).code, 200)
  assert.equal((await m.state()).requests.at(-1).item, 'eggs')
})

test('READER: an unsure text is offered back, and YES sends it; anything else drops it', async () => {
  const m = await market()
  const r = await m.send('jules', 'any eggs b4 5')
  assert.equal(r.body.reason, 'did_you_mean')
  assert.match((await m.inbox('jules')).at(-1).text, /Did you mean: NEED 1 CRATE EGGS BEFORE 5\? Reply YES/)
  const before = (await m.state()).requests.length
  assert.equal((await m.send('jules', 'yes')).code, 200)
  assert.equal((await m.state()).requests.length, before + 1)
  await m.send('ellis', 'any eggs b4 5')
  await m.send('ellis', 'hello')
  assert.notEqual((await m.send('ellis', 'YES')).code, 200, 'a stale suggestion is not sent')
})

test('READER: canonical commands and seller quotes are left alone', async () => {
  const m = await market()
  assert.equal((await m.send('ellis', 'E7 4200 Cedar Lane')).code, 200)
  assert.match((await m.inbox('mara')).at(-1).text, /4,200 credits/)
  assert.equal((await m.send('jules', 'NEED 1 CRATE MILK BEFORE 6PM')).code, 200)
})

test('RULES: every rule holds through a full flow and the report needs the token', async () => {
  const { m, code } = await held()
  await m.send('ellis', `GIVEN ${code} E7`)
  const s = await m.state()
  assert.equal(s.requests[0].state, 'collected')
  const report = (await m.rules()).json()
  assert.equal(report.broken, 0)
  assert.equal(report.rules.length, 9)
  assert.ok(report.rules.every(r => r.holding))
  assert.ok(report.checks >= 4 && report.events > 10)
  assert.equal((await m.rules(false)).statusCode, 401)
})

test('RULES: a replay that differs after restore shows I7 broken', () => {
  let n = 0
  const report = rulesReport({ events: [] }, () => ({ ...emptyMarketState('x'), nextRequestNumber: n++ }), e => e)
  assert.equal(report.broken, 1)
  assert.equal(report.rules.find(r => r.id === 'I7').holding, false)
  assert.ok(report.rules.filter(r => r.id !== 'I7').every(r => r.holding))
})

// Consumer round 2 (22 Nov): status, hints, units, wording.
test('ROUND2: STATUS (and "my code", "wetin dey happen") lists what is open, with the pickup code', async () => {
  const { m, code } = await held()
  for (const t of ['status', 'my code?', 'wetin dey happen']) {
    assert.equal((await m.send('mara', t)).code, 200, t)
    assert.match((await m.inbox('mara')).at(-1).text, new RegExp(`E7 1 crate eggs till [0-9]{2}:[0-9]{2}: held from Ellis .*pickup code ${code}`))
  }
  await m.send('ellis', 'status')
  assert.match((await m.inbox('ellis')).at(-1).text, /E7: the buyer holds your crate/)
  assert.ok(!(await m.inbox('ellis')).some(x => x.text.includes(`code ${code}`)), 'the seller never sees the code')
})

test('ROUND2: hints say what is missing', async () => {
  const m = await market()
  await m.send('ellis', 'E7 3800')
  assert.equal((await m.inbox('ellis')).at(-1).text, 'Add the pickup place: E7 3800 <place>.')
  await m.send('ellis', 'i get egg 1 crate 3200 for shop 4')
  assert.match((await m.inbox('ellis')).at(-1).text, /Is this an offer for E7\? Reply E7 3200 <pickup place>/)
  await m.send('jules', 'need 1 crate tomato before 5pm')
  assert.match((await m.inbox('jules')).at(-1).text, /eggs and milk/)
  await m.send('jules', 'need eggs')
  assert.match((await m.inbox('jules')).at(-1).text, /Add a time/)
})

test('ROUND2: 4.5k prices, milk units for sellers, routed notice, seller DONE and closed GIVEN wording', async () => {
  const m = await market()
  assert.equal((await m.send('ellis', 'E7 4.5k Cedar Lane')).code, 200)
  assert.match((await m.inbox('mara')).at(-1).text, /4,500 credits/)
  assert.equal((await m.send('jules', 'NEED 1 CRATE MILK BEFORE 6PM')).code, 200)
  assert.match((await m.inbox('ellis')).at(-1).text, /spare 1 bottle milk .* price for 1 bottle/)
  await m.send('ellis', 'DONE')
  assert.match((await m.inbox('ellis')).at(-1).text, /Sellers confirm a handover with GIVEN/)
  await m.send('mara', 'WIDEN E7')
  const s = await m.state()
  // route through the desk endpoint via the helper server
  await m.route('E7')
  assert.match((await m.inbox('mara')).at(-1).text, /E7: the coordinator sent your request to the North circle/)
  await m.send('mara', 'CANCEL E7')
  await m.send('ellis', 'GIVEN 123 E7')
  assert.match((await m.inbox('ellis')).at(-1).text, /E7: this request has been cancelled/)
  assert.ok(s)
})
