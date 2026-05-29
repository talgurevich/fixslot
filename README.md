# fixslot

WhatsApp slot-booking for a single personal trainer. Clients message a WhatsApp
number, get a numbered list of open slots, and reply with a number to book. The
trainer manages availability in a small web dashboard and is notified of every
booking.

A client goes from "first message" to "confirmed booking" in two messages:
pick a number, done. Slots that are already booked or outside availability are
never offered.

> **`spec.md` is the source of truth** for behavior. This README covers how to
> run, test, and develop the app; read the spec before changing how it works.

## Runs fully offline, no secrets

The repo ships with `MESSAGING_PROVIDER=fake` as the default, so you need **no
Green API credentials** to install, run, develop, or test. Outbound WhatsApp
messages are captured in memory by an in-process fake instead of hitting the
live gateway. The dashboard password defaults to `changeme`. Real Green API
credentials live only on the deploy machine and never enter the repo.

## Prerequisites

- Node.js >= 18 (an `.nvmrc` is included — `nvm use` picks the right version)

## Quick start

```bash
npm run setup     # install deps, create .env, create the DB, migrate, seed
npm run dev       # start the server + dashboard on http://localhost:3000
```

`npm run setup` is idempotent and does everything needed for a fresh clone:

1. copies `.env.example` → `.env` (offline defaults, no secrets) if missing
2. `npm install`
3. `npx prisma generate` — generate the Prisma client
4. `npx prisma migrate deploy` — create/upgrade the SQLite database
5. `npx prisma db seed` — seed availability and config

Then open <http://localhost:3000> and log in with the password from `.env`
(`changeme` by default).

## What you can test locally (no credentials)

Everything except actually sending/receiving real WhatsApp messages. The slot
logic, conversation flow, dashboard, and webhook normalization are all fully
exercisable offline.

### 1. The automated test suite — `npm test`

Vitest runs four suites against a throwaway SQLite DB (`prisma/test.db`) using
the in-memory fake provider only — tests never call the live Green API.

| Suite | Covers |
|-------|--------|
| `slotGenerator.test.ts` | Pure slot math: expanding availability rules into hourly slots, timezone-correct instants, dropping past slots, all-day vs. windowed blackouts, excluding booked slots, capping at `maxSlotsOffered`, recurrence within the horizon. |
| `conversationEngine.test.ts` | The booking state machine: offering a numbered slot list, the happy-path booking (confirm + notify trainer + reset), reprompting on invalid/out-of-range input, the "no slots" message, and the stale-pick case (slot taken meanwhile → re-offer). |
| `dashboard.test.ts` | The trainer dashboard API end to end (supertest): auth rejection, config read/create, availability replace/read, invalid-rule rejection, blackout add/list/delete, settings update, read-only bookings list, and the dev simulator. |
| `webhook.test.ts` | Normalizing inbound Green API payloads: text, extended text, non-text, and non-message webhooks. |

```bash
npm test          # run once
npm run test:watch  # re-run on change
```

### 2. Run the real app — `npm run dev`

Starts the Express server and dashboard at <http://localhost:3000> with live
reload. Fully functional offline:

- **Dashboard** — log in (`changeme`) to manage availability rules, blackout
  dates, and settings, and to view bookings.
- **Dev simulator** — a box in the dashboard that sends a fake inbound WhatsApp
  message and shows the bot's reply, no phone required.

### 3. Simulate a conversation from the CLI — `npm run sim`

With the dev server running in another terminal:

```bash
npm run sim "hi"                  # first contact → bot offers a numbered slot list
npm run sim "2"                   # pick slot #2 → bot confirms the booking
npm run sim "hi" 972501112222     # use a specific phone number (optional)
```

This POSTs a fake inbound payload to `/webhook`, exercising the whole
webhook → conversation engine → slot generator → notifier path. The bot's reply
prints in the `npm run dev` console.

## Project layout (spec §10)

| Unit | Responsibility | Lives in |
|------|----------------|----------|
| `MessagingProvider` + impls | Send WhatsApp messages | `src/messaging/` (`FakeProvider`, `GreenApiProvider`) |
| `slotGenerator` | Pure slot computation | `src/slotGenerator.ts` |
| `conversationEngine` | State machine: decides replies & bookings | `src/conversationEngine.ts` |
| `dashboard` (routes + UI) | Trainer availability & bookings management | `src/dashboard/` |
| `db` (Prisma models + helpers) | Persistence | `prisma/schema.prisma`, `src/db.ts` |
| `notifier` | Trainer booking notification | `src/notifier.ts` |
| webhook receiver | Normalizes inbound Green API payloads | `src/webhook.ts` |

The conversation engine and slot generator never touch Green API directly — all
WhatsApp I/O goes through the `MessagingProvider` interface, which lets tests
inject the in-memory fake.

## Configuration

`npm run setup` creates `.env` from `.env.example`. The offline defaults:

| Variable | Default | Purpose |
|----------|---------|---------|
| `MESSAGING_PROVIDER` | `fake` | `fake` (in-memory) or `greenapi` (live) |
| `DASHBOARD_PASSWORD` | `changeme` | Dashboard login |
| `TIMEZONE` | `Asia/Jerusalem` | All slot math runs in this zone |
| `PORT` | `3000` | Server port |
| `DATABASE_URL` | `file:./dev.db` | SQLite database file |
| `SESSION_SECRET` | `dev-only-not-secret` | Session cookie secret |

### Going live (requires credentials, not needed for local work)

To send and receive real WhatsApp messages via [Green API](https://green-api.com),
set in `.env`:

```bash
MESSAGING_PROVIDER=greenapi
GREEN_API_INSTANCE=<your-instance>
GREEN_API_TOKEN=<your-token>
```

These are the only things you can't exercise locally without an account.

## Scripts

| Command | Does |
|---------|------|
| `npm run setup` | One-command fresh-clone setup (deps, DB, seed) |
| `npm run dev` | Start server + dashboard with live reload |
| `npm start` | Start the server (no watch) |
| `npm run build` | Type-check / compile with `tsc` |
| `npm test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run sim "<msg>" [phone]` | Send a fake inbound WhatsApp message (dev) |
| `npm run seed` | Re-seed the database |
| `npm run prisma:migrate` | Create/apply a migration in dev |

## Notes

- Date math runs in `TIMEZONE` via luxon; keep slot computation zone-aware.
- `generateSlots` is pure (no DB/network) so it stays trivially testable.
- SQLite via Prisma. Dev DB is `prisma/dev.db`, tests use `prisma/test.db`;
  both are gitignored.
