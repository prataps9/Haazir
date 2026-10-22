# Progress

Three lines per phase (spec, "How to use this file").

## Phase 0: Foundation (done)

- pnpm + Turborepo monorepo (api, worker, dashboard, site; shared, db), strict TS, ESLint + Prettier, CI with a real Postgres/Redis job. docker-compose for Postgres 16 + pgvector, Redis 7 and Mailpit.
- zod-validated env, pino logging, `/health` + `/ready` (Postgres, Redis, worker heartbeat), graceful shutdown. Drizzle with the first migration (plans, organizations, users, memberships, super_admins) and an idempotent seed (3 plans, Shiksha Computer Institute, owner, staff, super admin).
- Dashboard: bahi-khata tokens (light/dark), self-hosted Anek Devanagari + Mukta, app shell (bottom tabs + "Aur" sheet on phones, sidebar on desktop), Hindi/English, and `/dev/components` with Button, Input, Card, LedgerCard, StatusPill and EmptyState. Contrast is tested in CI.

## Phase 1: WhatsApp echo (done; not yet tried against a real Meta number)

- Webhook verify + HMAC signature check on the raw body, inbound queue, contacts/conversations/messages/whatsapp_accounts tables (token AES-256-GCM encrypted), BSUID-aware contacts, delivery statuses that only move forward, media copied to storage (R2/MinIO or local disk). Graph API pinned to v26.0.
- Outbound gate (opt-out, 24h window, content limits) writes the row before Meta is called; the outbound worker retries Meta outages and records policy errors as failed. Duplicate deliveries store one row and send one reply, even if Redis loses its dedupe keys or a job crashes mid-way.
- 23 integration tests (PGlite + MSW) plus parser/signature/window unit tests; CI runs the full loop end to end with a mock Graph API. `pnpm whatsapp:mock` / `whatsapp:simulate` let anyone try it locally.

## Phase 2: AI brain (built; eval score pending an LLM key)

- Pipeline per §11.1: no-LLM pre-checks (opt-out, human mode with 2h expiry, bot off / no AI / hourly cap → handoff, media → handoff, voice → transcript), router (fast model, zod-validated), hybrid retrieval (pgvector + full-text, RRF, threshold), answer (smart model) with read-only tools, prompt `answer-v1`, guardrails (numbers, script, length, competitors, guarantees, injection) with one rewrite then handoff, ai_traces and unanswered_questions.
- Knowledge ingestion (FAQ, text, PDF via unpdf, website crawl with robots.txt, 20 pages, SSRF guard) on an `ingest` queue plus `pnpm knowledge:*` and `pnpm bot:ask`; speech-to-text via OpenAI or Sarvam (saaras:v3); courses, batches and bot config seeded for the demo institute; provider-agnostic (OpenAI, Anthropic, Google, Azure) via the Vercel AI SDK v7.
- 73 eval cases + runner (`pnpm evals`, fails < 85% or any invented number, checked independently of the guardrail) and a CI job that runs when a key is configured. 253 automated tests across the repo (91 new); the pipeline is tested with mock models, the retrieval SQL on real pgvector.

## Phase 3: multi-tenant + dashboard core (built; handoff push untested on a real Android phone)

- Better Auth with invites, roles (owner, admin, agent) and per-request org scoping; two seeded institutes with a test that every resource is invisible across them (404), a foreign `X-Org-Id` is 403, and Socket.IO rooms are per org. Migrations `0004_auth` and `0005_playground_conversations`.
- Dashboard screens: login and invite, Chat (live list, conversation, takeover and hand-back, window timer, contact panel), Bot ko sikhayein, Bot settings with a playground, Settings (notifications), and a super-admin screen that creates institutes and connects a WhatsApp number by hand. Handoff sends a socket event and a Web Push notification (VAPID, service worker deep link). The bot now uses the owner's menu button titles.
- 294 automated tests across the repo, all with mock models. Run against real Postgres and Redis with the mock Graph API: seed, log in as both institutes, take over, reply, reply read.

## Phase 4: coaching vertical (built; Razorpay and templates untested against the real services)

- New `packages/coaching` (leads, demo bookings, students, installments, receipts, Razorpay payment links + webhook check) and migration `0006_coaching_crm`. The bot books demos through a tap-through flow that works without an AI key, plus write tools (`book_demo`, `upsert_lead`, `send_brochure`, `send_location`, `get_my_fee_status`) applied by the worker after the reply; prompt `answer-v2`. Reminders on a `reminder` queue (demo 3h before, follow-up, daily fee sweep) respect the 24h window, templates, quiet hours and opt-out.
- Dashboard: Home "Aaj ka hisaab", Leads (Kanban + CSV), Courses & batches, Fees (links, cash, bulk reminders, walk-in admission), onboarding wizard with brochure auto-extract, Razorpay settings, Chat lead panel, tappable playground. Cross-org cases for every new route.
- 366 automated tests, all mock models. `scripts/e2e-coaching.sh` runs the "done when" journey on real Postgres and Redis in CI: enquiry → demo by taps → reminder → came → admitted → link → paid webhook → receipt → Home.

## Next: Phase 5, templates, campaigns and reports

Needs from Pratap: Razorpay test keys for one institute to try a real payment link and webhook; Meta approval for the seeded reminder templates (names in `packages/shared/src/templates.ts`); an LLM key to run the evals (now 73 cases on `answer-v2`) and the brochure extract; ~20 real Hindi voice notes to pick OpenAI vs Sarvam; where the dashboard and API are hosted for staging; a real Meta test number for the Phase 1 loop and Phase 3's Android push; a read of the eval cases.
