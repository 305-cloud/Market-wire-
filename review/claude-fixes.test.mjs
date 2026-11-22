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
  return { send, state, clock, inbox, e7 }
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
  assert.match((await m.inbox('ellis')).at(-1).text, /ask for their code and reply GIVEN code E7/)
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
  const ask = async () => { for (const who of ['jules', 'ellis', 'jules', 'ellis', 'mara']) await m.send(who, 'NEED 1 CRATE EGGS BEFORE 11PM') }
  await ask(); await m.clock(10)
  const n1 = (await m.inbox('coordinator')).filter(x => /asked/.test(x.text)).length
  await m.clock(115); await ask(); await m.clock(10)
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
  assert.match((await m.inbox('mara')).at(-1).text, /already hold this crate/)
})
