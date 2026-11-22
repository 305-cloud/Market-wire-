import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
  },
})
