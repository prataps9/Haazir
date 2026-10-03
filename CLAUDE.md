# Haazir: notes for coding agents

Read `docs/HAAZIR_SPEC.md` (source: `docs/HAAZIR_SPEC.pdf`) and `PROGRESS.md` before any work.
Build **one phase at a time** (spec §22). At the end of a phase, list files changed, commands, manual
test steps, tests added and known gaps (§23), then stop.

## Layout

- `apps/api`: Express 5. `src/app.ts` builds the app (tests use it directly), `src/index.ts` boots it. Auth (Better Auth) and org scoping are in `src/auth`; routes behind `orgScope` must filter every query by `orgOf(req).id`. Realtime is `src/realtime`.
- `apps/worker`: BullMQ processors. One `Worker` per queue; queue names live in `packages/shared/src/queues.ts`.
- `apps/dashboard`: React 19 + Vite + Tailwind v4. Tokens in `src/styles/tokens.css`, components in `src/components`, gallery at `/dev/components` (dev builds only).
- `apps/site`: public marketing site, deployed to Vercel from this repo (see `vercel.json`). Plain Vite/React JS until it becomes Astro in Phase 6. Not linted or formatted by the root config.
- `packages/shared`: zod env (`env.ts`), error codes, constants, money helpers. Browser-safe except `./env`.
- `packages/db`: Drizzle schema (`src/schema`), generated SQL in `migrations/`, idempotent `seed.ts`.
- `packages/channels/whatsapp`: pure Cloud API code (parser, signature, window rules, Graph client). No database.
- `packages/messaging`: `queueOutbound`, the one place anything is sent from. Never call `GraphClient.send` elsewhere.
- `packages/storage`: `createStorage(env)`: S3-compatible or local disk.
- `packages/ai-core`: the brain. `decideReply` decides and writes nothing; `effects.ts` applies decisions. Ingestion, speech-to-text, tools, guardrails and the versioned prompt live here.
- `evals/`: YAML conversations + runner. A bot bug found in the wild becomes an eval case first.

## Rules that bite

- Never read `process.env` outside `packages/shared/src/env.ts`. Add new variables there and to `.env.example`.
- Money is integer paise. Phone numbers are E.164 without "+". Times are stored in UTC and shown in Asia/Kolkata.
- Every tenant table has `org_id` + an index, and every query is scoped by it.
- Schema change: edit `packages/db/src/schema`, run `pnpm db:generate --name <what>`, and commit the SQL. Never edit a migration that has already been applied anywhere.
- Workspace packages ship TypeScript source. If an app bundles one, it must also list that package's npm dependencies (see `apps/api/tsup.config.ts`).
- Worker processors take a `Deps` object (db, kv, locks, queues, storage, graph) so tests run them on PGlite with fakes. Keep them idempotent: Meta redelivers, BullMQ retries.
- BullMQ job ids can't contain `:`.
- The bot quotes fees, dates and seats only from tool results (the database), never from documents or memory; the number guardrail enforces it. New facts the bot needs = a new tool, not prompt text.
- Changing the answer prompt: bump `ANSWER_PROMPT_VERSION` and run `pnpm evals`.
- Tests use `createTestDb()` from `@haazir/db/testing` (PGlite + pgvector) and the AI SDK's mock models; no test calls a real LLM.
- Don't put `NODE_ENV` in `.env`: Vite reads the same file and would build the dashboard in dev mode.
- Design (§14): tokens only (Tailwind's default palette and type scale are removed), status = icon + label + colour, no gradients, no card hover motion, no section fade-ins, no eyebrow labels, no all-caps, no trailing arrows. Hindi-first copy in `locales/hi.json` with the same keys as `en.json` (a test checks this).
- Ask Pratap before any decision that changes cost, pricing, or how personal data is stored.

- New org-scoped route = add a cross-org case to `apps/api/src/__tests__/tenancy.test.ts`.
- Anything shown to a person after a failed request goes through `errorText` (`apps/dashboard/src/lib/errors.ts`): server text for validation only, never raw errors.
- Events to the dashboard go through `OrgEvents.emit` (`packages/messaging`), never straight to Socket.IO; the worker and API are different processes.

## Checks

`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm format:check`, the same as CI.
