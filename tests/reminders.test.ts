import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { FakeProvider } from "../src/messaging";
import { findDueReminders, runRemindersOnce } from "../src/reminders";

const tz = "Asia/Jerusalem";
const NOW = new Date("2026-06-01T06:00:00.000Z");
const CLIENT = "972501234567";

async function seedConfig(leadMinutes = 60) {
  await prisma.config.create({
    data: {
      timezone: tz,
      trainerPhone: "972540000000",
      reminderLeadMinutes: leadMinutes,
      reminderTemplate: "Reminder: {slot}",
    },
  });
}

function bookingAt(startTime: Date, overrides: Partial<{ status: string; clientPhone: string }> = {}) {
  return prisma.booking.create({
    data: {
      clientPhone: overrides.clientPhone ?? CLIENT,
      clientName: "Test Client",
      startTime,
      status: overrides.status ?? "confirmed",
    },
  });
}

describe("findDueReminders (pure)", () => {
  const base = {
    id: 1,
    clientPhone: CLIENT,
    clientName: "x",
    status: "confirmed",
    createdAt: NOW,
    reminderSentAt: null as Date | null,
  };

  it("returns confirmed, unreminded, future bookings inside the lead window", () => {
    const due = findDueReminders(
      [{ ...base, startTime: new Date(NOW.getTime() + 30 * 60_000) }],
      60,
      NOW,
    );
    expect(due).toHaveLength(1);
  });

  it("skips bookings outside the lead window", () => {
    const due = findDueReminders(
      [{ ...base, startTime: new Date(NOW.getTime() + 2 * 60 * 60_000) }],
      60,
      NOW,
    );
    expect(due).toHaveLength(0);
  });

  it("skips past bookings, already-reminded bookings, and non-confirmed bookings", () => {
    const due = findDueReminders(
      [
        { ...base, id: 1, startTime: new Date(NOW.getTime() - 10 * 60_000) }, // past
        { ...base, id: 2, startTime: new Date(NOW.getTime() + 10 * 60_000), reminderSentAt: NOW }, // already reminded
        { ...base, id: 3, startTime: new Date(NOW.getTime() + 10 * 60_000), status: "cancelled" },
      ],
      60,
      NOW,
    );
    expect(due).toHaveLength(0);
  });
});

describe("runRemindersOnce (DB + provider)", () => {
  beforeEach(() => seedConfig(60));

  it("sends a reminder for a booking inside the lead window", async () => {
    const booking = await bookingAt(new Date(NOW.getTime() + 30 * 60_000));
    const fake = new FakeProvider();

    const sent = await runRemindersOnce(fake, NOW);

    expect(sent).toBe(1);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].toPhone).toBe(CLIENT);
    expect(fake.sent[0].text).toContain("Reminder:");

    const after = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(after?.reminderSentAt).not.toBeNull();
  });

  it("does not send a reminder outside the lead window", async () => {
    await bookingAt(new Date(NOW.getTime() + 3 * 60 * 60_000)); // 3h out, lead is 60min
    const fake = new FakeProvider();

    const sent = await runRemindersOnce(fake, NOW);

    expect(sent).toBe(0);
    expect(fake.sent).toHaveLength(0);
  });

  it("does not double-send across repeated runs", async () => {
    await bookingAt(new Date(NOW.getTime() + 30 * 60_000));
    const fake = new FakeProvider();

    await runRemindersOnce(fake, NOW);
    await runRemindersOnce(fake, NOW);
    await runRemindersOnce(fake, NOW);

    expect(fake.sent).toHaveLength(1);
  });

  it("does not remind past bookings", async () => {
    await bookingAt(new Date(NOW.getTime() - 60 * 60_000));
    const fake = new FakeProvider();

    const sent = await runRemindersOnce(fake, NOW);

    expect(sent).toBe(0);
    expect(fake.sent).toHaveLength(0);
  });

  it("does not remind cancelled bookings", async () => {
    await bookingAt(new Date(NOW.getTime() + 30 * 60_000), { status: "cancelled" });
    const fake = new FakeProvider();

    const sent = await runRemindersOnce(fake, NOW);

    expect(sent).toBe(0);
    expect(fake.sent).toHaveLength(0);
  });
});
