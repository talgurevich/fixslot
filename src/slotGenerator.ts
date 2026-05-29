import { DateTime } from "luxon";

// Plain input shapes (decoupled from Prisma) so this stays a pure, trivially
// testable function with no DB or network access (spec §5).
export interface SlotRule {
  weekday: number; // 0 = Sunday .. 6 = Saturday
  startTime: string; // "09:00"
  endTime: string; // "12:00"
}

export interface SlotBlackout {
  date: string; // "YYYY-MM-DD" in config.timezone
  startTime?: string | null; // optional "HH:MM"
  endTime?: string | null; // optional "HH:MM"
}

export interface ExistingBooking {
  startTime: Date;
}

export interface SlotConfig {
  slotDurationMinutes: number;
  bookingHorizonDays: number;
  maxSlotsOffered: number;
  timezone: string;
}

export interface Slot {
  start: Date; // exact instant of the slot start
}

// Walk forward from `now` across the booking horizon and expand weekly
// availability rules into concrete slots, dropping any slot that is in the past,
// inside a blackout, or already booked. Returns the first `maxSlotsOffered`.
// All date math happens in `config.timezone`.
export function generateSlots(
  rules: SlotRule[],
  blackouts: SlotBlackout[],
  bookings: ExistingBooking[],
  config: SlotConfig,
  now: Date,
): Slot[] {
  const zone = config.timezone;
  const nowZoned = DateTime.fromJSDate(now, { zone });
  const bookedInstants = new Set(bookings.map((b) => b.startTime.getTime()));
  const slots: Slot[] = [];

  const firstDay = nowZoned.startOf("day");
  for (let i = 0; i < config.bookingHorizonDays; i++) {
    const day = firstDay.plus({ days: i });
    const jsWeekday = day.weekday % 7; // luxon Mon=1..Sun=7 → 0=Sun..6=Sat
    const dateKey = day.toFormat("yyyy-MM-dd");
    const dayRules = rules.filter((r) => r.weekday === jsWeekday);
    const dayBlackouts = blackouts.filter((b) => b.date === dateKey);

    for (const rule of dayRules) {
      const ruleStart = applyTime(day, rule.startTime);
      const ruleEnd = applyTime(day, rule.endTime);

      for (
        let slotStart = ruleStart;
        slotStart.plus({ minutes: config.slotDurationMinutes }) <= ruleEnd;
        slotStart = slotStart.plus({ minutes: config.slotDurationMinutes })
      ) {
        const slotEnd = slotStart.plus({ minutes: config.slotDurationMinutes });

        if (slotStart <= nowZoned) continue; // past
        if (isBlackedOut(slotStart, slotEnd, day, dayBlackouts)) continue;

        const instant = slotStart.toJSDate();
        if (bookedInstants.has(instant.getTime())) continue; // already booked

        slots.push({ start: instant });
      }
    }
  }

  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots.slice(0, config.maxSlotsOffered);
}

function applyTime(day: DateTime, hhmm: string): DateTime {
  const [hour, minute] = hhmm.split(":").map(Number);
  return day.set({ hour, minute, second: 0, millisecond: 0 });
}

function isBlackedOut(
  slotStart: DateTime,
  slotEnd: DateTime,
  day: DateTime,
  dayBlackouts: SlotBlackout[],
): boolean {
  for (const b of dayBlackouts) {
    // No window → the whole day is blocked (vacation, sick day).
    if (!b.startTime || !b.endTime) return true;
    const bStart = applyTime(day, b.startTime);
    const bEnd = applyTime(day, b.endTime);
    // Overlap between [slotStart, slotEnd) and [bStart, bEnd).
    if (slotStart < bEnd && slotEnd > bStart) return true;
  }
  return false;
}
