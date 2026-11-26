import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/src/mcp/server.js'],
  env: { ...process.env, MCP_TARGET_URL: process.argv[2] ?? 'http://127.0.0.1:3000' },
})
const client = new Client({ name: 'market-wire-review', version: '1.0.0' })

async function call(name, args) {
  const outcome = await client.callTool({ name, arguments: args })
  const text = outcome.content[0]?.text ?? ''
  assert.ok(!outcome.isError, `${name}: ${text}`)
  assert.doesNotMatch(text, /Bearer|demo_token_|tok_/)
  return JSON.parse(text)
}

try {
  await client.connect(transport)
  const { tools } = await client.listTools()
  for (const name of ['market_create', 'market_send', 'market_send_duplicate', 'market_state', 'market_advance_clock', 'market_shortages']) {
    assert.ok(tools.some(tool => tool.name === name), name)
  }
  const { marketId } = await call('market_create', { marketName: 'MCP review' })
  assert.ok(marketId)
  const state = await call('market_state', { marketId })
  assert.equal(state.requests[0].code, 'E7')
  await call('market_send', { marketId, alias: 'ellis', text: 'E7 4200 Cedar Lane', providerMessageId: 'mcp-review-1' })
  await call('market_send_duplicate', { marketId, alias: 'ellis', text: 'E7 4200 Cedar Lane' })
  const updated = await call('market_state', { marketId })
  assert.equal(updated.offers.length, 1)
  const eventLog = await call('market_events', { marketId })
  const events = Array.isArray(eventLog) ? eventLog : eventLog.events
  assert.ok(events.some(event => event.type === 'offer_made'))
  // Claude (22 Nov): at most 3 open requests per trader, so the asks come from two traders.
  for (let index = 0; index < 4; index++) {
    await call('market_send', { marketId, alias: index < 2 ? 'mara' : 'jules', text: 'NEED 1 SACK FLOUR BEFORE 8',
      providerMessageId: 'mcp-shortage-' + index })
  }
  await call('market_advance_clock', { marketId, minutes: 10 })
  const summary = await call('market_shortages', { marketId })
  assert.deepEqual(summary.shortages.map(({ asked, filled }) => [asked, filled]), [[5, 0]])
  const alertEvents = (await call('market_events', { marketId })).events
  assert.equal(alertEvents.filter(event => event.type === 'shortage_alerted').length, 1)
  console.log('MCP stdio discovery, authentication, replay, clock and one aggregate shortage alert passed')
} finally {
  await client.close()
}
