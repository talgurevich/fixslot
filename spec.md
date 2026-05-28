# WhatsApp Slot-Booking for a Personal Trainer — Design Spec

**Date:** 2026-05-28
**Status:** Approved (design), pending implementation plan
**Scope:** MVP for a single personal trainer

## 1. Purpose

A personal trainer wants to let their clients book training time slots entirely through
WhatsApp, with a conversation so simple that any client can use it intuitively. The trainer
sets their availability in a small web dashboard; clients message the trainer's WhatsApp
number, are offered open slots, and confirm by replying with a number. The trainer is
notified of each new booking.

### Success criteria

- A client can go from "first message" to "confirmed booking" in 2 messages (pick a number, done).
- The trainer can set and update weekly availability and block-out dates without help.
- Slots that are already booked or outside availability are never offered.
- The trainer gets a WhatsApp notification and a dashboard entry for every booking.

### Explicit non-goals (MVP)

- No cancellations, reschedules, or reminders.
- No multi-trainer / multi-tenant support (single trainer only).
- No natural-language understanding — clients pick from a numbered list.
- No elaborate concurrency / hold-locking. (See §5 for the minimal correctness guard that *is* included.)
- No billing/payments.

## 2. Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| WhatsApp connectivity | **Green API** (managed unofficial gateway: REST send + webhook receive) | Fastest MVP path; no Meta business verification, no self-hosted WhatsApp client. ToS/ban risk accepted; mitigated by using a dedicated number. |
| Abstraction | **`MessagingProvider` interface** with a `GreenApiProvider` impl | Booking logic stays decoupled; future swap to official Meta Cloud API is a one-file change; enables an in-memory fake for tests. |
| Availability management | **Web dashboard** | Trainer wants clear visual control; simpler/less error-prone than WhatsApp commands. |
| Scope | **Single trainer** | This is for one client; avoids onboarding/billing/tenant-isolation complexity. |
| Stack | **Node.js + TypeScript (Express)** | Strong WhatsApp/webhook ecosystem; cheap hosting. |
| Booking flow | **Numbered-list pick** | Most intuitive for clients (reply with a number); no NLP; matches "ask → offer → confirm". |
| Trainer notification | **Both** WhatsApp message + dashboard entry | Maximum visibility for the trainer. |
| Database | **SQLite via Prisma** | Zero-config, file-based, perfect for a single-trainer MVP; typed models + easy migrations. |
| Dashboard auth | **Single shared password** (env var → session cookie) | One trainer; full auth system is overkill. |

## 3. High-level architecture

One Express + TypeScript service with three responsibilities:

1. **Webhook receiver** — Green API POSTs incoming WhatsApp messages to `POST /webhook`.
2. **Trainer dashboard** — small web UI + internal REST endpoints for availability and bookings.
3. **Booking brain** — slot generation, conversation state machine, and outbound replies via the messaging adapter.

```
Client (WhatsApp) → Green API → POST /webhook → Conversation engine
                                                      |
                          +------- Slot generator ----+---- DB (SQLite/Prisma)
                          |                                    ^
Trainer <- WhatsApp <- Green API <- Messaging adapter    Dashboard (Express UI)
```

Green API is accessed only through `MessagingProvider`:

```ts
interface MessagingProvider {
  sendMessage(toPhone: string, text: string): Promise<void>;
  // Inbound messages arrive via the webhook, are normalized, and dispatched
  // to the conversation engine's message handler.
}
```

## 4. Data model (Prisma / SQLite)

- **AvailabilityRule** — `id`, `weekday` (0–6), `startTime` ("09:00"), `endTime` ("12:00"). Recurring weekly windows.
- **Blackout** — `id`, `date` the trainer is unavailable, plus optional `startTime`/`endTime`. If the times are omitted the whole day is blocked (vacation, sick day); if provided, only that window is blocked (e.g. "out Tuesday afternoon"). Subtracted from availability.
- **Booking** — `id`, `clientPhone`, `clientName`, `startTime` (datetime), `status` (`confirmed`), `createdAt`. **Unique constraint on `startTime`** so a slot cannot be booked twice.
- **Conversation** — `id`, `clientPhone` (unique), `state` (`IDLE` | `AWAITING_SELECTION`), `offeredSlots` (JSON map: number → ISO datetime), `offeredAt` (timestamp). One row per client.
- **Config** (single row) — `slotDurationMinutes` (default 60), `bookingHorizonDays` (default 14), `maxSlotsOffered` (default 5), `trainerPhone`, `timezone` (IANA, e.g. `Asia/Jerusalem`), and editable message templates (greeting, confirmation, no-slots, reprompt).

## 5. Slot generation (core domain logic)

A **pure function**:

```
generateSlots(availabilityRules, blackouts, existingBookings, config, now) -> Slot[]
```

Algorithm: walk forward from `now` across `bookingHorizonDays`; for each day, expand the
matching weekly `AvailabilityRule`s into concrete slots at `slotDurationMinutes`; drop any
slot that is in the past, falls inside a `Blackout`, or matches an existing `Booking.startTime`.
Return the first `maxSlotsOffered` slots.

Pure (no DB/network access) so it is trivially unit-testable. All date math is performed in
`config.timezone`.

### Minimal double-booking guard (intentional, despite "no edge cases")

Full concurrency handling is out of scope, but basic correctness is cheap and included:
1. Booked slots are excluded from generation (never offered again).
2. On confirmation, the chosen slot is re-checked for availability before the Booking is created.
3. A unique constraint on `Booking.startTime` is the final backstop.

No holds, locks, reschedules, or cancellations.

## 6. Conversation flow (state machine)

Per-client state stored in the `Conversation` row.

- **Inbound message while `IDLE`** (or no row): run `generateSlots`; store the numbered mapping
  in `offeredSlots` with `offeredAt = now`; reply with greeting + numbered list; set state to
  `AWAITING_SELECTION`.

  ```
  Hi! Here are the next open slots:
  1. Mon 28 Jul, 09:00
  2. Mon 28 Jul, 10:00
  3. Tue 29 Jul, 17:00
  Reply with a number to book.
  ```

- **Valid number while `AWAITING_SELECTION`**: look up the slot in `offeredSlots`; re-check it
  is still open; create the `Booking`; reply confirmation (`Booked! Mon 28 Jul 10:00. See you then ✅`);
  notify the trainer (WhatsApp + dashboard); reset state to `IDLE`.

- **Invalid input while `AWAITING_SELECTION`** (not a number / out of range): gentle reprompt
  ("Please reply with one of the numbers above, e.g. 1–5.") — state unchanged.

- **No slots available**: reply with the configured "no open times right now" message; stay `IDLE`.

- **Stale pick** (offered slot was booked by someone else in the meantime): apologize and
  re-offer a fresh numbered list; stay `AWAITING_SELECTION`.

A client messaging again after a confirmed booking simply starts a new flow (can book another session).

## 7. Trainer dashboard

Single page, protected by one shared password (env var → session cookie). Sections:

- **Availability** — set weekly hours per weekday; set slot duration, booking horizon, and number of slots to offer.
- **Block-out dates** — add days the trainer is unavailable.
- **Bookings** — list of upcoming bookings (client name, phone, time). Read-only for MVP.
- **Settings** — trainer's WhatsApp number for notifications, timezone, message templates. (Green API credentials are supplied via environment variables, not the UI.)

UI is intentionally lightweight: server-served page with light vanilla JS, no separate frontend
build step. Can be upgraded to a React/Vite dashboard later if a richer availability grid is wanted.

## 8. Error handling & operations

- **Webhook**: respond `200` quickly, then process asynchronously. Validate payload shape.
  Non-text messages get a nudge to reply with a number.
- **Outbound send failure**: log and retry once.
- **Timezone**: all slot math uses `config.timezone`. Flagged explicitly — the classic source of bugs here.
- **Hosting**: requires a public HTTPS URL for the Green API webhook and persistent disk for the
  SQLite file (e.g. Render/Railway/Fly with a volume, or a small VPS). `ngrok` (or similar tunnel)
  for local development.
- **Security**: dedicated WhatsApp number for the bot to limit blast radius if the number is ever
  banned; dashboard behind shared-password auth; Green API token kept in env vars.

## 9. Testing strategy

- **Slot generation** — unit tests (highest value): rules + blackouts + bookings + now → expected slots,
  including timezone edge cases and horizon boundaries.
- **Conversation state machine** — tests using an in-memory fake `MessagingProvider`: feed inbound
  messages, assert outbound replies and resulting DB state (covers happy path, invalid input,
  no-slots, stale-pick).
- **Dashboard API** — tests for setting availability and listing bookings.
- No live WhatsApp / Green API calls in the test suite.

## 10. Component boundaries (for implementation)

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `MessagingProvider` + `GreenApiProvider` | Send/receive WhatsApp messages | Green API HTTP |
| `slotGenerator` | Pure slot computation | Config, rules, blackouts, bookings (passed in) |
| `conversationEngine` | State machine, decides replies & bookings | `slotGenerator`, DB, `MessagingProvider` |
| `dashboard` (routes + UI) | Trainer availability & bookings management | DB, auth |
| `db` (Prisma models + repo) | Persistence | SQLite |
| `notifier` | Trainer booking notification | `MessagingProvider`, DB |

Each unit is independently testable; the conversation engine and slot generator never touch
Green API directly.
