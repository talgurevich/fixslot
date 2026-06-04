import { describe, it, expect, beforeEach } from "vitest";
import { DateTime } from "luxon";
import { prisma } from "../src/db";
import { FakeProvider } from "../src/messaging";
import { handleInbound } from "../src/conversationEngine";

const tz = "Asia/Jerusalem";
const MONDAY = "2026-06-01";
const mondayWeekday = DateTime.fromISO(MONDAY, { zone: tz }).weekday % 7;
const NOW = DateTime.fromISO(`${MONDAY}T06:00`, { zone: tz }).toJSDate();
const CLIENT = "972501234567";

function at(isoLocal: string): Date {
  return DateTime.fromISO(isoLocal, { zone: tz }).toJSDate();
}

async function seedAvailability() {
  await prisma.config.create({
    data: {
      timezone: tz,
      trainerPhone: "972540000000",
      slotDurationMinutes: 60,
      maxSlotsOffered: 5,
      bookingHorizonDays: 7, // keep only the first Monday in range for deterministic counts
    },
  });
  await prisma.availabilityRule.create({
    data: { weekday: mondayWeekday, startTime: "09:00", endTime: "12:00" },
  });
}

describe("conversationEngine", () => {
  beforeEach(seedAvailability);

  it("offers a numbered slot list on first contact and awaits selection", async () => {
    const fake = new FakeProvider();
    await handleInbound(fake, CLIENT, "hi", { now: NOW });

    expect(fake.sent).toHaveLength(1);
    const text = fake.last()!.text;
    expect(text).toContain("1.");
    expect(text).toContain("Reply with a number");

    const convo = await prisma.conversation.findUnique({ where: { clientPhone: CLIENT } });
    expect(convo?.state).toBe("AWAITING_SELECTION");
    expect(Object.keys(JSON.parse(convo!.offeredSlots))).toHaveLength(3);
  });

  it("books a slot, confirms, notifies the trainer, and resets state (happy path)", async () => {
    const fake = new FakeProvider();
    await handleInbound(fake, CLIENT, "hi", { now: NOW });
    await handleInbound(fake, CLIENT, "1", { now: NOW, clientName: "Test Client" });

    const booking = await prisma.booking.findFirst();
    expect(booking).not.toBeNull();
    expect(booking!.clientName).toBe("Test Client");
    expect(booking!.startTime.toISOString()).toBe("2026-06-01T06:00:00.000Z"); // 09:00 IDT
    expect(booking!.status).toBe("confirmed");

    // confirmation to the client + notification to the trainer
    const confirmation = fake.sent.find((m) => m.toPhone === CLIENT && m.text.startsWith("Booked!"));
    const notification = fake.sent.find((m) => m.toPhone === "972540000000");
    expect(confirmation).toBeTruthy();
    expect(notification).toBeTruthy();
    expect(notification!.text).toContain("Test Client");

    const convo = await prisma.conversation.findUnique({ where: { clientPhone: CLIENT } });
    expect(convo?.state).toBe("IDLE");
  });

  it("reprompts on invalid input without changing state", async () => {
    const fake = new FakeProvider();
    await handleInbound(fake, CLIENT, "hi", { now: NOW });
    fake.clear();

    await handleInbound(fake, CLIENT, "not a number", { now: NOW });

    expect(fake.last()!.text).toContain("number");
    expect(await prisma.booking.count()).toBe(0);
    const convo = await prisma.conversation.findUnique({ where: { clientPhone: CLIENT } });
    expect(convo?.state).toBe("AWAITING_SELECTION");
  });

  it("reprompts on an out-of-range number", async () => {
    const fake = new FakeProvider();
    await handleInbound(fake, CLIENT, "hi", { now: NOW });
    fake.clear();

    await handleInbound(fake, CLIENT, "9", { now: NOW });

    expect(await prisma.booking.count()).toBe(0);
    const convo = await prisma.conversation.findUnique({ where: { clientPhone: CLIENT } });
    expect(convo?.state).toBe("AWAITING_SELECTION");
  });

  it("sends the no-slots message when nothing is available", async () => {
    await prisma.availabilityRule.deleteMany();
    const fake = new FakeProvider();

    await handleInbound(fake, CLIENT, "hi", { now: NOW });

    expect(fake.last()!.text).toContain("no open times");
    const convo = await prisma.conversation.findUnique({ where: { clientPhone: CLIENT } });
    expect(convo?.state).toBe("IDLE");
  });

  it("re-offers fresh slots when the picked slot was taken in the meantime (stale pick)", async () => {
    const fake = new FakeProvider();
    await handleInbound(fake, CLIENT, "hi", { now: NOW });

    // Someone else books slot #1 (09:00) before this client replies.
    await prisma.booking.create({
      data: { clientPhone: "972509999999", clientName: "Other", startTime: at(`${MONDAY}T09:00`) },
    });
    fake.clear();

    await handleInbound(fake, CLIENT, "1", { now: NOW });

    expect(fake.last()!.text).toContain("just taken");
    // No new booking for this client; only the other person's booking exists.
    expect(await prisma.booking.count()).toBe(1);
    const convo = await prisma.conversation.findUnique({ where: { clientPhone: CLIENT } });
    expect(convo?.state).toBe("AWAITING_SELECTION");
    // The fresh list no longer contains 09:00.
    const offered = JSON.parse(convo!.offeredSlots) as Record<string, string>;
    expect(Object.values(offered)).not.toContain(at(`${MONDAY}T09:00`).toISOString());
  });

  describe("reschedule flow", () => {
    async function bookClientSlot(startTime: Date) {
      return prisma.booking.create({
        data: { clientPhone: CLIENT, clientName: "Test Client", startTime },
      });
    }

    it("offers reschedule slots when client has an upcoming booking", async () => {
      const existingSlot = at(`${MONDAY}T09:00`);
      await bookClientSlot(existingSlot);

      const fake = new FakeProvider();
      await handleInbound(fake, CLIENT, "hi", { now: NOW });

      const text = fake.last()!.text;
      expect(text).toContain("You have a booking for");
      expect(text).toContain("reschedule");
      expect(text).toContain("Reply with a number to book.");

      const convo = await prisma.conversation.findUnique({ where: { clientPhone: CLIENT } });
      expect(convo?.state).toBe("AWAITING_RESCHEDULE");
      expect(convo?.reschedulingBookingId).not.toBeNull();
    });

    it("moves the booking to the new slot and confirms (happy path)", async () => {
      const existingSlot = at(`${MONDAY}T09:00`);
      const booking = await bookClientSlot(existingSlot);

      const fake = new FakeProvider();
      await handleInbound(fake, CLIENT, "hi", { now: NOW });
      fake.clear();

      // Pick the second offered slot (10:00) since 09:00 is already the booking.
      await handleInbound(fake, CLIENT, "1", { now: NOW, clientName: "Test Client" });

      // Only one booking should exist (updated, not a second row).
      expect(await prisma.booking.count()).toBe(1);
      const updated = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(updated!.startTime.toISOString()).not.toBe(existingSlot.toISOString());

      const confirmation = fake.sent.find((m) => m.toPhone === CLIENT);
      expect(confirmation!.text).toContain("Rescheduled!");

      const trainerMsg = fake.sent.find((m) => m.toPhone === "972540000000");
      expect(trainerMsg!.text).toContain("Rescheduled:");
      expect(trainerMsg!.text).toContain("Test Client");

      const convo = await prisma.conversation.findUnique({ where: { clientPhone: CLIENT } });
      expect(convo?.state).toBe("IDLE");
      expect(convo?.reschedulingBookingId).toBeNull();
    });

    it("reprompts on invalid input during reschedule without changing state", async () => {
      await bookClientSlot(at(`${MONDAY}T09:00`));

      const fake = new FakeProvider();
      await handleInbound(fake, CLIENT, "hi", { now: NOW });
      fake.clear();

      await handleInbound(fake, CLIENT, "not a number", { now: NOW });

      expect(fake.last()!.text).toContain("number");
      const convo = await prisma.conversation.findUnique({ where: { clientPhone: CLIENT } });
      expect(convo?.state).toBe("AWAITING_RESCHEDULE");
    });

    it("re-offers fresh slots when the target slot is taken during reschedule (stale pick)", async () => {
      await bookClientSlot(at(`${MONDAY}T09:00`));

      const fake = new FakeProvider();
      await handleInbound(fake, CLIENT, "hi", { now: NOW });

      // Someone books slot #1 of the offered list before the client replies.
      const offered = JSON.parse(
        (await prisma.conversation.findUnique({ where: { clientPhone: CLIENT } }))!.offeredSlots,
      ) as Record<string, string>;
      const slot1Time = new Date(offered["1"]);
      await prisma.booking.create({
        data: { clientPhone: "972509999999", clientName: "Other", startTime: slot1Time },
      });
      fake.clear();

      await handleInbound(fake, CLIENT, "1", { now: NOW });

      expect(fake.last()!.text).toContain("just taken");
      const convo = await prisma.conversation.findUnique({ where: { clientPhone: CLIENT } });
      expect(convo?.state).toBe("AWAITING_RESCHEDULE");
    });

    it("original slot becomes bookable by others after reschedule", async () => {
      const existingSlot = at(`${MONDAY}T09:00`);
      await bookClientSlot(existingSlot);

      const fake = new FakeProvider();
      await handleInbound(fake, CLIENT, "hi", { now: NOW });
      await handleInbound(fake, CLIENT, "1", { now: NOW, clientName: "Test Client" });

      // The old slot should no longer be in Booking as the startTime of this booking.
      const stillAtOld = await prisma.booking.findUnique({ where: { startTime: existingSlot } });
      expect(stillAtOld).toBeNull();
    });
  });
});
