#!/usr/bin/env bash
# Phase 5 end to end: templates approved by Meta's webhook, a campaign to 50
# opted-in contacts sent throttled (nobody who said STOP), delivered, actual
# cost equal to the estimate, and Reports showing it. Built API and worker on
# real Postgres and Redis; the mock answers for Meta.
# Expects `pnpm build`, a migrated + seeded database and the WhatsApp env vars.
set -euo pipefail

# Each background job gets its own process group (set -m), so cleanup stops
# the whole tree: `pnpm whatsapp:mock` leaves a tsx child behind otherwise.
set -m
cleanup() { for pid in "${PIDS[@]}"; do kill -- "-$pid" 2>/dev/null || true; done; }
PIDS=()
trap cleanup EXIT

# CI may run at any hour; campaigns otherwise wait out 9 PM to 8 AM IST.
export QUIET_HOURS_OFF=true
pnpm whatsapp:connect
pnpm whatsapp:mock > /tmp/mock-campaign.log 2>&1 & PIDS+=($!)
node apps/api/dist/index.js > /tmp/api-campaign.log 2>&1 & PIDS+=($!)
node apps/worker/dist/index.js > /tmp/worker-campaign.log 2>&1 & PIDS+=($!)

for i in $(seq 1 30); do
  curl -sf "$API_URL/ready" > /dev/null && break
  sleep 1
done

if ! pnpm --filter @haazir/api exec tsx scripts/e2e-campaign.ts; then
  echo "--- api";    tail -40 /tmp/api-campaign.log
  echo "--- worker"; tail -40 /tmp/worker-campaign.log
  echo "--- mock";   tail -40 /tmp/mock-campaign.log
  exit 1
fi
