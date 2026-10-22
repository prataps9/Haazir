#!/usr/bin/env bash
# Phase 4 end to end: WhatsApp enquiry → demo booked → reminder → attended →
# admitted → payment link → paid → receipt → Home. Built API and worker on
# real Postgres and Redis; the mock answers for Meta and Razorpay.
# Expects `pnpm build`, a migrated + seeded database and the WhatsApp env vars.
set -euo pipefail

# Each background job gets its own process group (set -m), so cleanup stops
# the whole tree: `pnpm whatsapp:mock` leaves a tsx child behind otherwise.
set -m
cleanup() { for pid in "${PIDS[@]}"; do kill -- "-$pid" 2>/dev/null || true; done; }
PIDS=()
trap cleanup EXIT

export RAZORPAY_BASE_URL=http://localhost:4010
pnpm whatsapp:connect
pnpm whatsapp:mock > /tmp/mock-coaching.log 2>&1 & PIDS+=($!)
node apps/api/dist/index.js > /tmp/api-coaching.log 2>&1 & PIDS+=($!)
node apps/worker/dist/index.js > /tmp/worker-coaching.log 2>&1 & PIDS+=($!)

for i in $(seq 1 30); do
  curl -sf "$API_URL/ready" > /dev/null && break
  sleep 1
done

if ! pnpm --filter @haazir/api exec tsx scripts/e2e-coaching.ts; then
  echo "--- api";    tail -40 /tmp/api-coaching.log
  echo "--- worker"; tail -40 /tmp/worker-coaching.log
  echo "--- mock";   tail -40 /tmp/mock-coaching.log
  exit 1
fi
