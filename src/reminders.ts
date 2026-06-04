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

// Find every due reminder and send it through the messaging adapter.
// At-most-once is enforced by a conditional update: we set `reminderSentAt`
// only if it is still NULL, so even if two ticks race or the process restarts
// mid-loop, a given booking can only be claimed (and sent) once.
export async function runRemindersOnce(
  provider: MessagingProvider,
  now: Date = new Date(),
  prisma: PrismaClient = defaultPrisma,
): Promise<number> {
  const config = await getConfig();
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
    await provider.sendMessage(booking.clientPhone, reminderText(config, booking.startTime));
    sent++;
  }
  return sent;
}
