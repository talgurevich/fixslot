# fixslot

WhatsApp slot-booking for a single personal trainer. Clients message a WhatsApp
number, get a numbered list of open slots, and reply with a number to book. The
trainer manages availability in a small web dashboard and is notified of every
booking.

**`spec.md` is the source of truth.** Read it before changing behavior.

## Run it

```bash
npm run setup     # install deps, create the DB, apply migrations, seed data
npm run dev       # start the server + dashboard on http://localhost:3000
npm test          # unit + integration tests (all green)
npm run sim "hi"  # POST a fake inbound WhatsApp message to /webhook (dev only)
```

Runs fully offline with no secrets: `MESSAGING_PROVIDER=fake` is the default, so
no Green API credentials are needed to install, run, develop, or test. The
dashboard password defaults to `changeme` (see `.env.example`).

To test the conversation in the browser, log into the dashboard and use the
**Dev simulator** box. The CLI equivalent is `npm run sim "<message>" [phone]`
(watch the `npm run dev` console for the bot's reply).

## Component map (spec §10)

| Unit | Responsibility | Lives in |
|------|----------------|----------|
| `MessagingProvider` + impls | Send WhatsApp messages | `src/messaging/` (`FakeProvider`, `GreenApiProvider`) |
| `slotGenerator` | Pure slot computation | `src/slotGenerator.ts` |
| `conversationEngine` | State machine: decides replies & bookings | `src/conversationEngine.ts` |
| `dashboard` (routes + UI) | Trainer availability & bookings management | `src/dashboard/` |
| `db` (Prisma models + helpers) | Persistence | `prisma/schema.prisma`, `src/db.ts` |
| `notifier` | Trainer booking notification | `src/notifier.ts` |
| webhook receiver | Normalizes inbound Green API payloads | `src/webhook.ts` |

The conversation engine and slot generator never touch Green API directly.

## Conventions

- **Tests use the in-memory `FakeProvider` only — never call the live Green API
  in tests** (spec §9). Inject a provider into `handleInbound`/`notifier`.
- All date math runs in `Config.timezone` (via luxon). Timezones are the classic
  bug source here — keep slot math zone-aware.
- `generateSlots` is pure (no DB/network). Keep it that way so it stays trivially
  testable.
- SQLite via Prisma. Dev DB is `prisma/dev.db`; tests use `prisma/test.db`. Both
  are gitignored. Real credentials never enter the repo.

## For students

Three features are intentionally missing — see the GitHub issues. Pick one, stay
in its files, and don't touch the other lanes. Write your PR description from the
spec, not from the diff. Read the codebase; the issues are deliberately not a
step-by-step recipe.
