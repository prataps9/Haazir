#!/usr/bin/env bash
# End-to-end check of the Phase 1 loop against real Postgres and Redis, with
# the mock Graph API standing in for Meta:
#   signed webhook (delivered twice) → API → inbound → ai-reply → outbound
#   → mock Meta → signed statuses back → message marked read.
# Expects built api/worker (pnpm build), a migrated + seeded database, and the
# WhatsApp env vars set (CI sets them; locally, your .env does).
set -euo pipefail

# Each background job gets its own process group (set -m), so cleanup stops
# the whole tree: `pnpm whatsapp:mock` leaves a tsx child behind otherwise.
set -m
cleanup() { for pid in "${PIDS[@]}"; do kill -- "-$pid" 2>/dev/null || true; done; }
PIDS=()
trap cleanup EXIT

pnpm whatsapp:connect
pnpm whatsapp:mock > /tmp/mock-graph.log 2>&1 & PIDS+=($!)
node apps/api/dist/index.js > /tmp/api.log 2>&1 & PIDS+=($!)
node apps/worker/dist/index.js > /tmp/worker.log 2>&1 & PIDS+=($!)

for i in $(seq 1 30); do
  curl -sf "$API_URL/ready" > /dev/null && break
  sleep 1
done

FROM="91990000$(date +%s | tail -c 5)"
pnpm whatsapp:simulate --repeat 2 --from "$FROM" "E2E: fees kitni hai?"

q() { psql "$DATABASE_URL" -Atc "$1"; }
for i in $(seq 1 30); do
  STATUS=$(q "select m.status from messages m join conversations v on v.id = m.conversation_id
              join contacts c on c.id = v.contact_id
              where c.wa_id = '$FROM' and m.direction = 'out'")
  [ "$STATUS" = "read" ] && break
  sleep 1
done

IN=$(q "select count(*) from messages m join conversations v on v.id = m.conversation_id
        join contacts c on c.id = v.contact_id where c.wa_id = '$FROM' and m.direction = 'in'")
OUT=$(q "select count(*) from messages m join conversations v on v.id = m.conversation_id
         join contacts c on c.id = v.contact_id where c.wa_id = '$FROM' and m.direction = 'out'")

echo "inbound rows: $IN, replies: $OUT, reply status: ${STATUS:-none}"
if [ "$IN" != "1" ] || [ "$OUT" != "1" ] || [ "$STATUS" != "read" ]; then
  echo "--- api";    tail -40 /tmp/api.log
  echo "--- worker"; tail -40 /tmp/worker.log
  echo "--- mock";   tail -40 /tmp/mock-graph.log
  exit 1
fi
echo "E2E passed: one message stored from two deliveries, one reply, delivered and read."
