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

## Phase 5: templates, campaigns and reports (built; untested against Meta's real template review)

- Templates checked against Meta's rules before submitting (the seeded set fixed to pass), submitted one by one or all, kept in step by Meta's webhooks and a 15-minute poll; staff can send one from Chat after the 24-hour window. Migration `0007_campaigns` (meta_rates in centipaise, campaigns, campaign_recipients, messages.billable).
- Campaigns to opted-in contacts only (tag, stage, course, batch; a live count of who is left out), preview for a real person, estimate with GST, scheduled or sent now, never at night, paced 25 at a time every 500 ms, retry-safe, cancellable; results from Meta's statuses with failure reasons and actual cost. Staff record consent; campaign replies become enquiries with source campaign; the owner's 8 PM summary; Reports with tiles, charts and cost by kind. Agents see none of it (spec §19).
- 408 automated tests. `scripts/e2e-campaign.sh` runs the "done when" in CI on real Postgres and Redis: 50 opted-in contacts, 5 left out, throttled, actual cost equal to the estimate.

## Outside the phases: agent + marketing system (asked for by Pratap, Nov 2026)

Six steps, one at a time, plan agreed with Pratap. Phase 6 is still next after them.

1. **Landing page shows both halves (done).** `apps/site` gained `Marketing.jsx` (leads, reminders
   and follow-ups, campaigns, payment links, reports, opt-out and quiet hours) and `Loop.jsx`, a nav
   link, a marketing paragraph per segment and three FAQ entries. Gradients, the hero glow, section
   fade-ins, heading pills and the trailing arrow are gone. Claims the product can't back were
   reworded ("will not get banned", "live calendar", "a real exchange", green tick, quality rating
   monitoring). Positioning and prices unchanged. Still placeholders: the WhatsApp number and
   domain in `src/lib/site.js`. The page describes bookings and reminders for jewellers, clinics and
   hotels, but only the coaching vertical is built.
2. **Fixes to what already existed (done).**
   - The bot now uses three settings it used to ignore: tone (prompt `answer-v3`), the languages it
     may reply in, and the privacy notice link (added once, to the first message a person is sent).
     Languages and the link are new fields in Bot settings.
   - Each bot reply is linked to its `ai_traces` row (`messages.ai_trace_id`), and the language a
     person was answered in is saved on the contact, so reminders pick the matching template.
   - A chat can be marked done (`POST /conversations/:id/close`, a "Done" filter and pill); the
     person's next message reopens it with the bot answering.
   - Leads with a call-back due today or late show as a count on Home and as one push at 10 AM
     (with the fee sweep). Not added to the 8 PM WhatsApp summary: that is an approved template
     with four fixed values.
   - Site: `robots.txt`, `sitemap.xml` and JSON-LD are written at build time.
   - Known gaps: evals did not run (no LLM key), so the tone wording is untested on a real model;
     no screenshots were taken of the new Bot settings fields or the Done state; the trace link
     has no screen yet.
3. **After-hours line and self opt-in (done).**
   - A normal reply sent while the institute is closed ends with one line saying when it opens
     (the owner's after-hours text if set, else ours). Said once a night (`flowState.awayAt`, 12h),
     and never in the middle of a tap or a booking. Handoffs keep their own after-hours line.
   - A person can opt in themselves: the whole message START / subscribe / shuru, or the yes button
     on a one-time question ("Naye batch aur offers ki jaankari bhejein?") sent after their third
     message. Recorded with source `keyword` or `button` and the time. Their own START undoes their
     own STOP; staff still cannot. New `optin` decision; `optInContact` in `effects.ts`.
   - A handoff no longer forgets that the question was asked.
   - Known gaps: the START word list is fixed in code, not editable like the STOP words; evals did
     not run (no LLM key); the three e2e scripts were not run here (no Postgres server), though
     their flows were read and should not be affected; at night an eval reply is longer by the
     closed line, which could trip a `max_chars` case.
4. **Contacts page, list import, saved segments (done).** Migration `0008_segments`.
   - `/contacts` (everyone on the team): search, filter by consent, tag and stage, tick people and
     add or remove a tag on all of them. Owners and admins can download the list as CSV and bring
     one in. Screenshots in `docs/screenshots/contacts/`.
   - Import: the CSV is read in the browser (phone, name, tags, consent columns, English or Hindi
     headings); numbers are tidied by the new `normalisePhone` in `@haazir/shared`; repeats merge;
     unreadable rows are reported by row number. People from a list stay "not asked" and out of
     campaigns unless the file has a consent column and the uploader switches on "We have their
     consent"; then the source is `import`. A list never undoes a STOP. Every import is in
     `audit_logs` with the declaration.
   - Segments: a named set of the campaign filters (`segments` table, owners and admins). The
     count beside each comes from `audienceCount`; the campaign builder can start from one, and
     shows the tags in use as chips. The list itself uses `contactsWhere`, beside `audienceWhere`
     in `packages/messaging/src/campaigns.ts`.
   - Verified: unit and API tests (import, consent, tenancy), all three e2e scripts on real
     Postgres and Redis, and an import through the browser.
   - Known gaps: a segment saves only the tag and stage chosen on the Contacts page (course and
     batch come from the campaign builder); no rename screen for segments (the API has it); 2,000
     rows per import; the list pages by offset, 50 at a time; `contacts.customFields` still has no
     screen. Locally the mock Meta server kept an old `apps/api/.data/mock-templates.json` that
     made the campaign e2e fail on a fresh database; removing that file fixes it.
5. **Ad source and what a campaign led to (done).** Migration `0009_attribution`.
   - The webhook parser keeps Meta's `referral` (Click-to-WhatsApp ad or post) on the inbound
     message (`messages.referral`). A lead created from such a message gets source `ad` and the
     ad's id, headline and link; the lead sheet shows the headline.
   - A reply within 7 days of a campaign message puts that campaign on the lead
     (`leads.campaign_id`), for new and existing leads alike, until the lead is admitted. The last
     campaign answered wins, so one person counts for one campaign. `source` still means where
     they first came from.
   - Campaign results show what it led to: people who replied, demos booked, admissions and fees
     received after it started (`campaignOutcomes`). Reports has "Where enquiries came from", by
     source, with admissions for each.
   - Verified: parser, worker and campaign tests; all three e2e scripts on a fresh database.
   - Known gaps: Meta's `referral` shape is taken from its documentation and has not been seen
     from a real ad; no screen lists leads per ad; `leads.campaign_id` has no foreign key (the
     schema files would import each other); the outcome tiles were tested by query, not seen in
     the browser with real replies; the ad click id is stored on the message but not used.
6. **Follow-up sequences (done).** Migration `0010_sequences`; page `/follow-ups` is `/sequences`
   in the app (nav "Follow-ups", owners and admins).
   - Three fixed triggers, one sequence each, up to 3 template messages, off until switched on:
     asked but no demo booked (timed from the first message), booked but did not come, came but
     not admitted (both timed from the class). It is not a flow builder (spec §3).
   - An hourly `sequence_sweep` on the `reminder` queue enrols leads that reach a trigger after the
     sequence was switched on (old leads are never messaged) and sends due steps through
     `sendAutomation` with the chosen template: free text inside the 24-hour window, the approved
     template outside it, never between 9 PM and 8 AM, only to people who said yes to updates.
   - A lead is in one sequence at a time and never in the same one twice. A sequence ends when the
     person replies, books a demo (for the first two), is admitted or lost, sends STOP, staff take
     the chat, or its template is no longer approved.
   - A step can only use an approved template whose blanks are a name, course or batch. The page
     shows the most one lead can cost (Meta's rate per step), switched off by default.
   - Verified: 12 worker tests (timing, consent, every stop rule, night hold, no double send), 4 API
     tests and a tenancy case; checks; all three e2e scripts on a fresh database; the page in the
     browser at desktop and phone width.
   - Known gaps: nothing has been sent through real Meta, so a step's template category (and so its
     charge) is as the owner approved it; no per-lead view of where someone is in a sequence; the
     cost shown is a ceiling and ignores that some steps will land in a free window; the e2e
     campaign script only passes on a database no earlier run has used (also true before this
     step; CI starts fresh), so reset the local database between runs.

## Next: Phase 6, business layer, hardening and launch

Needs from Pratap: confirm Meta's India rates for the card (seeded ₹0.8631 marketing, ₹0.1150 utility and authentication, from 1 Jul 2026); a real WABA with `whatsapp_business_management` to see real template reviews; Razorpay test keys; an LLM key for the evals and brochure extract; ~20 Hindi voice notes; staging hosting; a Meta test number for the Phase 1 loop and Android push; a read of the eval cases.
