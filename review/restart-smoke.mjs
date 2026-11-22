import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

assert.ok(process.env.DATABASE_URL, 'Use a dedicated PostgreSQL test database.')
const port = process.env.MARKET_WIRE_RESTART_PORT ?? '32589'
const origin = `http://127.0.0.1:${port}`
let child

async function start() {
  child = spawn(process.execPath, ['dist/src/index.js'], {
    env: { ...process.env, PORT: port },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited ${child.exitCode}`)
    try {
      if ((await fetch(origin + '/healthz')).ok) return
    } catch {}
    await delay(250)
  }
  throw new Error('Server did not become ready')
}

async function stop() {
  if (!child || child.exitCode !== null) return
  const exited = once(child, 'exit')
  child.kill()
  await exited
}

async function api(path, body, token) {
  const response = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json()
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(result)}`)
  return result
}

try {
  await start()
  const { marketId, token } = await api('/api/demo/markets', {})
  const market = `/api/demo/markets/${marketId}`
  const sms = (alias, text) => api(market + '/inbound', { alias, text, providerMessageId: randomUUID() }, token)
  await sms('ellis', 'E7 4200 Cedar Lane')
  await sms('mara', '1 E7')
  await api(market + '/clock', { minutes: 15 }, token)
  const before = await api(market + '/state', undefined, token)
  assert.equal(before.requests[0].state, 'held')
  const pickupText = before.messages.find(message => message.recipient === 'mara' && message.text.includes('Pickup code'))
  const pickupCode = /Pickup code (\d{3})/.exec(pickupText.text)[1]
  await stop()
  await start()
  const recovered = await api(market + '/state', undefined, token)
  assert.equal(recovered.requests[0].state, 'held')
  assert.equal(recovered.currentTime, before.currentTime)
  await sms('ellis', 'GIVEN ' + pickupCode + ' E7')
  await sms('mara', 'DONE E7')
  const collected = await api(market + '/state', undefined, token)
  assert.equal(collected.requests[0].state, 'collected')
  assert.equal((await api(market + '/events', undefined, token)).events
    .filter(event => event.type === 'request_collected').length, 1)
  console.log('Service restart preserved the authenticated hold, pickup code and simulated clock.')
} finally {
  await stop()
}
