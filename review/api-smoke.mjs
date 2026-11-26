import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const origin = process.argv[2] ?? 'http://127.0.0.1:3000'

async function api(path, { method = 'GET', token, body, status = 200 } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const payload = await res.json()
  assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(payload)}`)
  return payload
}

const health = await api('/healthz')
assert.ok(health.ok || health.status === 'ok')
const market = await api('/api/demo/markets', { method: 'POST', body: {}, status: 201 })
const other = await api('/api/demo/markets', { method: 'POST', body: {}, status: 201 })
let token = market.token
const marketPath = `/api/demo/markets/${market.marketId}`

const send = (alias, text, providerMessageId = randomUUID()) => api(`${marketPath}/inbound`, {
  method: 'POST', token, body: { alias, text, providerMessageId },
})
const snapshot = () => api(`${marketPath}/state`, { token })
const request = (state, code) => state.requests.find(entry => entry.code === code)

await api(`${marketPath}/state`, { status: 401 })
const unauthorized = await fetch(`${origin}${marketPath}/state`, { headers: { authorization: `Bearer ${other.token}` } })
assert.ok([401, 403, 404].includes(unauthorized.status))
const firstSnapshot = await snapshot()
assert.equal(new Date(firstSnapshot.currentTime).getUTCHours(), 15)
assert.ok(firstSnapshot.messages.some(message => message.from === 'mara'))
assert.doesNotMatch(JSON.stringify(firstSnapshot), /\b(?:lagos|idumota|balogun|ada|bose|chidi|tunde|ngn)\b/i)
if (!request(await snapshot(), 'E7')) await send('mara', 'Need 1 sack flour before 6')

await send('ellis', 'E7 4200 Cedar Lane')
assert.ok((await snapshot()).messages.some(message => /4,200 credits/.test(message.text)))
assert.equal((await snapshot()).messages.filter(message => message.to === 'room').length, 0)
await send('mara', '1 E7')
assert.equal(request(await snapshot(), 'E7').state, 'held')
const receiptId = randomUUID()
await send('mara', 'DONE', receiptId)
await send('mara', 'DONE', receiptId)
assert.equal(request(await snapshot(), 'E7').state, 'collected')
console.log('E7 local offer, hold, collection, duplicate receipt and quiet room verified')

if (!request(await snapshot(), 'E8')) await send('jules', 'Need 1 sack flour before 6')
assert.equal(new Date(request(await snapshot(), 'E8').cutoffAt).getUTCHours(), 18)
await send('jules', 'WIDEN E8')
const widened = await snapshot()
assert.equal(request(widened, 'E8').state, 'widened')
assert.equal(widened.messages.filter(message => message.to === 'room').length, 1)
await api(`${marketPath}/coordinator/route`, {
  method: 'POST', token, body: { requestCode: 'E8', circleId: 'north' },
})
await send('rowan', 'E8 4800 North Arcade')
await send('jules', '1 E8')
assert.equal(request(await snapshot(), 'E8').state, 'held')
await send('jules', 'DONE')
assert.equal(request(await snapshot(), 'E8').state, 'collected')
console.log('E8 buyer consent, coordinator dispatch, neighboring quote and collection verified')

const reset = await api(`${marketPath}/reset`, { method: 'POST', token, body: {} })
assert.ok(reset.token && reset.token !== token)
await api(`${marketPath}/state`, { token, status: 401 })
token = reset.token
assert.ok(!(await snapshot()).requests.some(entry => entry.state === 'collected'))
await api(`/api/demo/markets/${other.marketId}/state`, { token: other.token })
console.log('Reset rotates one token without affecting the other market')

await api(`${marketPath}/clock`, { method: 'POST', token, body: { minutes: 155 } })
const fallback = await snapshot()
assert.ok(fallback.messages.some(message => /call|contacts/i.test(message.text)), 'Expected the fallback before closing')
await api(`${marketPath}/clock`, { method: 'POST', token, body: { minutes: 30 } })
assert.equal(request(await snapshot(), 'E7').state, 'expired')
const late = await fetch(`${origin}${marketPath}/inbound`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ alias: 'ellis', text: 'E7 4200 Cedar Lane', providerMessageId: randomUUID() }),
})
assert.equal(late.status, 400)
assert.equal(request(await snapshot(), 'E7').state, 'expired')
console.log('Early fallback, expiry and late-reply rejection verified')

const quoteMarket = await api('/api/demo/markets', { method: 'POST', body: {}, status: 201 })
const quotePath = `/api/demo/markets/${quoteMarket.marketId}`
const quoteSend = (alias, text, status = 200) => api(quotePath + '/inbound', {
  method: 'POST', token: quoteMarket.token, status,
  body: { alias, text, providerMessageId: randomUUID() },
})
await quoteSend('ellis', 'E7 4200 Cedar Lane')
await quoteSend('ellis', 'E7 5000 Cedar Lane')
await quoteSend('mara', '1', 400)
await quoteSend('mara', '1 E7', 400)
await quoteSend('mara', '1 E7 V1', 400)
await quoteSend('mara', '1 E7 V2')
assert.equal(request(await api(quotePath + '/state', { token: quoteMarket.token }), 'E7').state, 'held')
console.log('A delayed reply cannot accept a revised price. Explicit acceptance of the new quote works.')
