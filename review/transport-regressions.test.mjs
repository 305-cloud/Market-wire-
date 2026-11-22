// Regression cases from the local Market Wire build review.
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
  const r = await server.inject({ method: 'POST', url: '/api/demo/markets', payload: {} })
  const { marketId, token } = r.json()
  const auth = { authorization: `Bearer ${token}` }
  const send = async (alias, text) => {
    const res = await server.inject({ method: 'POST', url: `/api/demo/markets/${marketId}/inbound`, headers: auth,
      payload: { alias, text, providerMessageId: randomUUID() } })
    return { code: res.statusCode, body: res.json() }
  }
  const state = async () => (await server.inject({ method: 'GET', url: `/api/demo/markets/${marketId}/state`, headers: auth })).json()
  const clock = async minutes => server.inject({ method: 'POST', url: `/api/demo/markets/${marketId}/clock`, headers: auth, payload: { minutes } })
  return { server, marketId, auth, send, state, clock }
}

test('BUG-1: another seller revising their quote blocks "1" for an untouched offer', async () => {
  const m = await market()
  assert.equal((await m.send('ellis', 'E7 4200 Cedar Lane')).code, 200)   // ref 1, v1
  assert.equal((await m.send('jules', 'E7 4500 Oak Row')).code, 200)      // ref 2, v1
  assert.equal((await m.send('jules', 'E7 4400 Oak Row')).code, 200)      // ref 2, v2
  const r = await m.send('mara', '1')
  assert.equal(r.code, 200, 'Mara should be able to hold Ellis\'s unrevised offer with the "1" she was told to send')
})

test('BUG-2: reply number 1 is reused for a different seller on the same request', async () => {
  const m = await market()
  assert.equal((await m.send('jules', 'NEED 1 CRATE EGGS BEFORE 5')).code, 200)  // E8 by Jules, invites Mara and Ellis
  await m.send('ellis', 'E7 4200 Cedar Lane')   // Ellis offers to Mara on E7, ref 1
  await m.send('ellis', 'E8 4200 Cedar Lane')   // same crate to Jules on E8, ref 1
  assert.equal((await m.send('jules', '1 E8')).code, 200)                      // Jules holds Ellis's crate
  await m.send('jules', 'E7 3000 Oak Row')       // Jules now offers to Mara on E7
  const s = await m.state()
  const julesOffer = s.offers.find(o => o.requestCode === 'E7' && o.sellerAlias === 'Jules')
  assert.notEqual(julesOffer.ref, '1', 'Mara was already told "Reply 1" for Ellis; Jules must get a new number')
})

test('BUG-3: a rejected reply sends the trader nothing', async () => {
  const m = await market()
  await m.send('ellis', 'E7 4200 Cedar Lane')
  await m.clock(240)                                   // past 18:00 cutoff, request expires
  const before = (await m.state()).messages.length
  const r = await m.send('mara', '1')
  const after = (await m.state()).messages.length
  assert.ok(after > before, 'trader should get one plain "this request is closed" reply')
})

test('BUG-4: price shown to buyer is 1/100 of what a trader would type', async () => {
  const m = await market()
  await m.send('ellis', 'E7 4200 Cedar Lane')
  const msg = (await m.state()).messages.at(-1)
  assert.match(msg.text, /4,?200/)
})

test('BUG-5: bare CANCEL with two open requests cancels one without asking', async () => {
  const m = await market()
  assert.equal((await m.send('mara', 'NEED 1 CRATE EGGS BEFORE 5')).code, 200)   // E8
  const r = await m.send('mara', 'CANCEL')
  const s = await m.state()
  assert.equal(s.requests.filter(request => request.state === 'open_local').length, 2)
  assert.ok(s.messages.some(message => /CANCEL E7.*CANCEL E8/i.test(message.text)))
  assert.notEqual(r.code, 200, 'should ask "CANCEL E7 or CANCEL E8?"')
})

test('a named cancellation affects only the named request', async () => {
  const m = await market()
  assert.equal((await m.send('mara', 'NEED 1 CRATE EGGS BEFORE 5')).code, 200)
  assert.equal((await m.send('mara', 'CANCEL E8')).code, 200)
  const state = await m.state()
  assert.equal(state.requests.find(request => request.code === 'E7').state, 'open_local')
  assert.equal(state.requests.find(request => request.code === 'E8').state, 'cancelled')
})

test('an expired hold tells the seller their crate is available again', async () => {
  const m = await market()
  await m.send('ellis', 'E7 4200 Cedar Lane')
  assert.equal((await m.send('mara', '1 E7')).code, 200)
  await m.clock(240)
  assert.ok((await m.state()).messages.some(message =>
    message.to === 'desktop' && message.from === 'ellis' && /crate is free again/i.test(message.text)))
})

test('BUG-6: MCP market_events has no API route', async () => {
  const m = await market()
  for (const p of ['events', 'messages']) {
    const res = await m.server.inject({ method: 'GET', url: `/api/demo/markets/${m.marketId}/${p}`, headers: m.auth })
    assert.equal(res.statusCode, 200)
  }
})

test('BUG-7: market creation is unlimited (no rate limit, no cap)', async () => {
  const server = await createServer()
  servers.push(server)
  let created = 0
  for (let i = 0; i < 60; i++) {
    const r = await server.inject({ method: 'POST', url: '/api/demo/markets', payload: {}, remoteAddress: '203.0.113.9' })
    if (r.statusCode === 201) created++
  }
  assert.ok(created <= 10)
})

test('BUG-8: non-string text crashes with a 500', async () => {
  const m = await market()
  const res = await m.server.inject({ method: 'POST', url: `/api/demo/markets/${m.marketId}/inbound`, headers: m.auth,
    payload: { alias: 'mara', text: 12345, providerMessageId: randomUUID() } })
  assert.equal(res.statusCode, 400)
})

test('history routes require the market token', async () => {
  const m = await market()
  for (const resource of ['events', 'messages']) {
    const res = await m.server.inject({ method: 'GET', url: `/api/demo/markets/${m.marketId}/${resource}` })
    assert.equal(res.statusCode, 401)
  }
})

test('oversized inbound bodies are rejected before creating a message', async () => {
  const m = await market()
  const before = (await m.state()).messages
  const res = await m.server.inject({
    method: 'POST',
    url: `/api/demo/markets/${m.marketId}/inbound`,
    headers: m.auth,
    payload: { alias: 'mara', text: 'x'.repeat(17 * 1024), providerMessageId: randomUUID() },
  })
  assert.equal(res.statusCode, 413)
  assert.deepEqual((await m.state()).messages, before)
})

test('demo sessions expire on the wall clock even without market-clock advances', async t => {
  const realNow = Date.now
  const createdAt = realNow()
  t.mock.method(Date, 'now', () => createdAt)
  const m = await market()
  const read = () => m.server.inject({
    method: 'GET', url: `/api/demo/markets/${m.marketId}/state`, headers: m.auth,
  })
  assert.equal((await read()).statusCode, 200)
  t.mock.restoreAll()
  t.mock.method(Date, 'now', () => createdAt + 24 * 60 * 60 * 1000 + 1)
  assert.equal((await read()).statusCode, 404)
})

test('after midday, an unqualified deadline of 8 means 20:00 in the simulator', async () => {
  const m = await market()
  assert.equal((await m.send('mara', 'NEED 1 CRATE EGGS BEFORE 8')).code, 200)
  assert.match((await m.state()).requests.find(request => request.code === 'E8').cutoffAt, /T20:00:/)
})

test('an invalid alias leaves the delivery ID available for the corrected message', async () => {
  const m = await market()
  const providerMessageId = randomUUID()
  const send = alias => m.server.inject({
    method: 'POST', url: `/api/demo/markets/${m.marketId}/inbound`, headers: m.auth,
    payload: { alias, text: 'E7 4200 Cedar Lane', providerMessageId },
  })
  assert.equal((await send('typo')).statusCode, 400)
  assert.equal((await send('ellis')).statusCode, 200)
  assert.equal((await m.state()).offers.length, 1)
  await send('ellis')
  assert.equal((await m.state()).offers.length, 1)
})

test('the price range and pickup code are scoped to the exchange participants', async () => {
  const m = await market()
  await m.send('ellis', 'E7 4200 Cedar Lane')
  const quote = (await m.state()).messages.find(message => message.text.includes('Usual today'))
  assert.equal(quote.recipient, 'mara')
  assert.equal(quote.sender, 'Ellis')
  assert.match(quote.text, /4,200-4,400 \(5 trades\)/)
  assert.ok(quote.text.length <= 160)
  assert.equal((await m.send('mara', '1 E7')).code, 200)
  const held = await m.state()
  const fromBuyer = held.messages.find(message => message.recipient === 'mara' &&
    message.text.includes('Pickup code'))
  const code = /Pickup code (\d{3})/.exec(fromBuyer.text)[1]
  const sellerMessage = held.messages.find(message => message.text.includes('GIVEN ' + code))
  assert.equal(sellerMessage.recipient, 'ellis')
  assert.ok(held.messages.every(message => message.to !== 'room'))
  const wrong = code === '100' ? '101' : '100'
  assert.equal((await m.send('ellis', 'GIVEN ' + wrong + ' E7')).code, 400)
  assert.equal((await m.state()).requests[0].state, 'held')
  assert.equal((await m.send('ellis', 'GIVEN ' + code + ' E7')).code, 200)
  assert.equal((await m.send('mara', 'DONE E7')).code, 200)
  const events = (await m.server.inject({
    method: 'GET', url: `/api/demo/markets/${m.marketId}/events`, headers: m.auth,
  })).json().events
  assert.equal(events.filter(event => event.type === 'request_collected').length, 1)
  assert.equal(events.find(event => event.type === 'hold_created').pickupCode, code)
})

test('five unmet asks generate exactly one aggregate coordinator alert in the window', async () => {
  const m = await market()
  for (let i = 0; i < 3; i++) {
    assert.equal((await m.send('mara', 'NEED 1 CRATE EGGS BEFORE 8')).code, 200)
  }
  await m.clock(1)
  assert.equal((await m.state()).messages.filter(message => message.to === 'room').length, 0)
  assert.equal((await m.send('mara', 'NEED 1 CRATE EGGS BEFORE 8')).code, 200)
  await m.clock(1)
  await m.clock(1)
  const dispatches = (await m.state()).messages.filter(message => message.to === 'room')
  assert.deepEqual(dispatches.map(message => message.text), ['eggs, Local: 5 asked, 0 filled in 2h.'])
  const url = `/api/demo/markets/${m.marketId}/shortages`
  assert.equal((await m.server.inject({ method: 'GET', url })).statusCode, 401)
  const { shortages } = (await m.server.inject({ method: 'GET', url, headers: m.auth })).json()
  assert.deepEqual(shortages.map(({ asked, filled, open }) => ({ asked, filled, open })), [{ asked: 5, filled: 0, open: 5 }])
})

test('a seller can pause and resume future invitations', async () => {
  const m = await market()
  assert.equal((await m.send('ellis', 'STOP')).code, 200)
  assert.equal((await m.send('mara', 'NEED 1 CRATE EGGS BEFORE 8')).code, 200)
  assert.ok(!(await m.state()).requests.find(request => request.code === 'E8').invitedSellers.includes('ellis'))
  assert.equal((await m.send('ellis', 'START')).code, 200)
  assert.equal((await m.send('mara', 'NEED 1 CRATE EGGS BEFORE 8')).code, 200)
  assert.ok((await m.state()).requests.find(request => request.code === 'E9').invitedSellers.includes('ellis'))
})
