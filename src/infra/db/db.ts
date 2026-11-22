// Database setup and connection pool for Market Wire.

import { Pool } from 'pg'
import { Kysely, PostgresDialect } from 'kysely'
import type { MarketWireDB } from './schema.js'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required')
}

export function createDatabase(): Kysely<MarketWireDB> {
  const dialect = new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) })
  return new Kysely<MarketWireDB>({ dialect })
}

export { Pool }
