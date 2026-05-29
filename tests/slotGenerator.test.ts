import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  generateSlots,
  SlotRule,
  SlotBlackout,
  SlotConfig,
  ExistingBooking,
} from "../src/slotGenerator";

const tz = "Asia/Jerusalem";

// 2026-06-01 is a Monday. weekday() maps it to the JS 0=Sun..6=Sat convention.
const MONDAY = "2026-06-01";
const mondayWeekday = DateTime.fromISO(MONDAY, { zone: tz }).weekday % 7;

function at(isoLocal: string): Date {
  return DateTime.fromISO(isoLocal, { zone: tz }).toJSDate();
}

function hours(slots: { start: Date }[]): string[] {
  return slots.map((s) => DateTime.fromJSDate(s.start, { zone: tz }).toFormat("HH:mm"));
}

const baseConfig = (over: Partial<SlotConfig> = {}): SlotConfig => ({
  slotDurationMinutes: 60,
  bookingHorizonDays: 1,
  maxSlotsOffered: 10,
  timezone: tz,
  ...over,
});

const morningRule: SlotRule = {
  weekday: mondayWeekday,
  startTime: "09:00",
  endTime: "12:00",
};

describe("generateSlots", () => {
  it("expands a rule into hourly slots", () => {
    const slots = generateSlots([morningRule], [], [], baseConfig(), at(`${MONDAY}T06:00`));
    expect(hours(slots)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("computes slot instants in the configured timezone (not UTC)", () => {
    const slots = generateSlots([morningRule], [], [], baseConfig(), at(`${MONDAY}T06:00`));
    // 09:00 in Asia/Jerusalem in June (UTC+3, IDT) is 06:00Z.
    expect(slots[0].start.toISOString()).toBe("2026-06-01T06:00:00.000Z");
  });

  it("drops slots at or before now", () => {
    const slots = generateSlots([morningRule], [], [], baseConfig(), at(`${MONDAY}T10:00`));
    expect(hours(slots)).toEqual(["11:00"]);
  });

  it("removes the whole day for an all-day blackout", () => {
    const blackouts: SlotBlackout[] = [{ date: MONDAY, startTime: null, endTime: null }];
    const slots = generateSlots([morningRule], blackouts, [], baseConfig(), at(`${MONDAY}T06:00`));
    expect(slots).toHaveLength(0);
  });

  it("removes only overlapping slots for a windowed blackout", () => {
    const blackouts: SlotBlackout[] = [{ date: MONDAY, startTime: "10:00", endTime: "11:00" }];
    const slots = generateSlots([morningRule], blackouts, [], baseConfig(), at(`${MONDAY}T06:00`));
    expect(hours(slots)).toEqual(["09:00", "11:00"]);
  });

  it("excludes slots that match an existing booking", () => {
    const bookings: ExistingBooking[] = [{ startTime: at(`${MONDAY}T10:00`) }];
    const slots = generateSlots([morningRule], [], bookings, baseConfig(), at(`${MONDAY}T06:00`));
    expect(hours(slots)).toEqual(["09:00", "11:00"]);
  });

  it("caps the result at maxSlotsOffered", () => {
    const slots = generateSlots(
      [morningRule],
      [],
      [],
      baseConfig({ maxSlotsOffered: 2 }),
      at(`${MONDAY}T06:00`),
    );
    expect(hours(slots)).toEqual(["09:00", "10:00"]);
  });

  it("includes recurrences within the horizon but not beyond it", () => {
    // Horizon of 8 days from a Monday includes the next Monday (day +7).
    const slots = generateSlots(
      [morningRule],
      [],
      [],
      baseConfig({ bookingHorizonDays: 8, maxSlotsOffered: 100 }),
      at(`${MONDAY}T06:00`),
    );
    expect(slots).toHaveLength(6); // 3 today + 3 next Monday
  });

  it("returns nothing when there are no matching rules", () => {
    const otherDay: SlotRule = { weekday: (mondayWeekday + 1) % 7, startTime: "09:00", endTime: "12:00" };
    const slots = generateSlots([otherDay], [], [], baseConfig(), at(`${MONDAY}T06:00`));
    expect(slots).toHaveLength(0);
  });
});
