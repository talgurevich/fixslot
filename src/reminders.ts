import type { Booking, Config, PrismaClient } from "@prisma/client";
import { MessagingProvider } from "./messaging";
import { formatSlot } from "./format";
import { getConfig, prisma as defaultPrisma } from "./db";

// Pure: which of these bookings are due for a reminder right now?
// A booking is due iff it is confirmed, still in the future, not yet reminded,
// and its start is within `leadMinutes` of `now`. Kept pure so it's trivially
// unit-testable without a DB or clock.
export function findDueReminders(
  bookings: Booking[],
  leadMinutes: number,
  now: Date,
): Booking[] {
  const windowEnd = now.getTime() + leadMinutes * 60_000;
  return bookings.filter(
    (b) =>
      b.status === "confirmed" &&
      b.reminderSentAt === null &&
      b.startTime.getTime() > now.getTime() &&
      b.startTime.getTime() <= windowEnd,
  );
}

function reminderText(config: Config, startTime: Date): string {
  return config.reminderTemplate.replace(
    "{slot}",
    formatSlot(startTime, config.timezone),
  );
}

export interface RunRemindersOptions {
  now?: Date;
  config?: Config;
  prisma?: PrismaClient;
}

// Find every due reminder and send it through the messaging adapter.
// At-most-once is enforced by a conditional update: we set `reminderSentAt`
// only if it is still NULL, so even if two ticks race or the process restarts
// mid-loop, a given booking can only be claimed (and sent) once.
export async function runRemindersOnce(
  provider: MessagingProvider,
  opts: RunRemindersOptions = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const prisma = opts.prisma ?? defaultPrisma;
  const config = opts.config ?? (await getConfig());

  const candidates = await prisma.booking.findMany({
    where: {
      status: "confirmed",
      reminderSentAt: null,
      startTime: {
        gt: now,
        lte: new Date(now.getTime() + config.reminderLeadMinutes * 60_000),
      },
    },
  });

  let sent = 0;
  for (const booking of candidates) {
    const claim = await prisma.booking.updateMany({
      where: { id: booking.id, reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    if (claim.count === 0) continue; // someone else already claimed it
    if (await sendWithRetry(provider, booking.clientPhone, reminderText(config, booking.startTime))) {
      sent++;
    }
  }
  return sent;
}

// Per spec §8 ("log and retry once") — try once, retry once on failure, then
// give up and log. The booking stays claimed either way so we never spam the
// client on subsequent ticks; in the worst case a single reminder is lost.
async function sendWithRetry(
  provider: MessagingProvider,
  to: string,
  text: string,
): Promise<boolean> {
  try {
    await provider.sendMessage(to, text);
    return true;
  } catch (err) {
    try {
      await provider.sendMessage(to, text);
      return true;
    } catch (err2) {
      console.error(`[reminders] send failed (after retry) for ${to}:`, err2);
      return false;
    }
  }
}
