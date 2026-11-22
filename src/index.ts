// src/index.ts
// Market Wire V2 — demo server entry point.
// Run:  npm run dev

import { createServer } from './http/server.js'

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const HOST = process.env.HOST ?? '127.0.0.1'

const server = await createServer()

server.listen({ port: PORT, host: HOST }, (err, addr) => {
  if (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
  console.log(`Market Wire demo server listening on ${addr}`)
  console.log(`Open: http://${HOST}:${PORT}/`)
})
