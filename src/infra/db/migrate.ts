// Database migration runner.

import { createDatabase } from './db.js'
import { up } from './migrations/0001_init.js'

let db: Awaited<ReturnType<typeof createDatabase>> | undefined

try {
  db = await createDatabase()
  await up(db)
  console.log('Migration completed successfully')
} finally {
  await db?.destroy()
}
