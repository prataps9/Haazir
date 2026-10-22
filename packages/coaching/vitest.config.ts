import { defineConfig } from 'vitest/config'

// These tests run real Postgres (PGlite, in-process). Migrating takes a couple
// of seconds, more when turbo runs every package's tests at once.
export default defineConfig({
  test: { hookTimeout: 60_000, testTimeout: 30_000 },
})
