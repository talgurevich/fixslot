import type { Config, Conversation } from "@prisma/client";
import { prisma, getConfig } from "./db";
import { MessagingProvider } from "./messaging";
import { generateSlots } from "./slotGenerator";
import { formatSlot } from "./format";
import {
  notifyTrainerOfBooking,
  notifyTrainerOfCancellation,
  notifyTrainerOfReschedule,
} from "./notifier";

export interface InboundOptions {
  now?: Date;
  clientName?: string;
}

// Trigger word that puts the conversation into the cancellation branch (spec
// issue #2). Kept as a single intuitive keyword to stay consistent with the
// numbered-list style — no NLP, no menus.
const CANCEL_KEYWORD = /^cancel$/i;

// Entry point for an inbound client message (spec §6). Drives the per-client
// state machine and sends replies via the injected provider so the engine never
// touches Green API directly.
export async function handleInbound(
  provider: MessagingProvider,
  phone: string,
  rawText: string,
  opts: InboundOptions = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const clientName = opts.clientName ?? phone;
  const text = (rawText ?? "").trim();
  const config = await getConfig();

  const convo = await prisma.conversation.upsert({
    where: { clientPhone: phone },
    create: { clientPhone: phone },
    update: {},
  });

  // "cancel" works from any state — a natural escape hatch into the cancel
  // branch even mid-booking.
  if (CANCEL_KEYWORD.test(text)) {
    await offerCancellations(provider, phone, config, now);
    return;
  }

  if (convo.state === "AWAITING_CANCEL_SELECTION") {
    await handleCancelSelection(provider, phone, text, convo, config, now);
    return;
  }

  if (convo.state === "AWAITING_SELECTION") {
    await handleSelection(provider, phone, text, convo, config, now, clientName);
    return;
  }

  if (convo.state === "AWAITING_RESCHEDULE") {
    await handleReschedule(provider, phone, text, convo, config, now, clientName);
    return;
  }

  // IDLE: if the client has an upcoming booking, enter the reschedule flow.
  const existingBooking = await prisma.booking.findFirst({
    where: { clientPhone: phone, startTime: { gt: now } },
    orderBy: { startTime: "asc" },
  });

  if (existingBooking) {
    await offerRescheduleSlots(provider, phone, config, now, existingBooking, false);
    return;
  }

  // No upcoming booking — offer slots for a new booking.
  await offerSlots(provider, phone, config, now, false);
}

async function handleSelection(
  provider: MessagingProvider,
  phone: string,
  text: string,
  convo: Conversation,
  config: Config,
  now: Date,
  clientName: string,
): Promise<void> {
  const offered = JSON.parse(convo.offeredSlots) as Record<string, string>;
  const offeredCount = Object.keys(offered).length;

  // Only a bare number is a valid selection (spec §6).
  const match = text.match(/^(\d+)$/);
  const iso = match ? offered[match[1]] : undefined;
  if (!iso) {
    await provider.sendMessage(phone, reprompt(config, offeredCount));
    return; // state unchanged
  }

  const startTime = new Date(iso);

  // Re-check the slot is still open before committing (spec §5 guard #2).
  if (!(await isSlotStillOpen(startTime, now))) {
    await offerSlots(provider, phone, config, now, true); // stale → re-offer
    return;
  }

  try {
    await prisma.booking.create({
      data: { clientPhone: phone, clientName, startTime },
    });
  } catch (err) {
    // Unique constraint on startTime is the final backstop (spec §5 guard #3).
    if (isUniqueViolation(err)) {
      await offerSlots(provider, phone, config, now, true);
      return;
    }
    throw err;
  }

  await prisma.conversation.update({
    where: { clientPhone: phone },
    data: { state: "IDLE", offeredSlots: "{}", offeredAt: null },
  });

  await provider.sendMessage(phone, confirmation(config, startTime));
  await notifyTrainerOfBooking(provider, {
    trainerPhone: config.trainerPhone,
    clientName,
    clientPhone: phone,
    startTime,
    timezone: config.timezone,
  });
}

async function handleReschedule(
  provider: MessagingProvider,
  phone: string,
  text: string,
  convo: Conversation,
  config: Config,
  now: Date,
  clientName: string,
): Promise<void> {
  const offered = JSON.parse(convo.offeredSlots) as Record<string, string>;
  const offeredCount = Object.keys(offered).length;

  const match = text.match(/^(\d+)$/);
  const iso = match ? offered[match[1]] : undefined;
  if (!iso) {
    await provider.sendMessage(phone, reprompt(config, offeredCount));
    return;
  }

  const newStartTime = new Date(iso);

  const bookingId = convo.reschedulingBookingId;
  if (!bookingId) {
    await offerSlots(provider, phone, config, now, false);
    return;
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    // Booking disappeared — fall back to new booking flow.
    await offerSlots(provider, phone, config, now, false);
    return;
  }

  if (!(await isSlotStillOpen(newStartTime, now))) {
    await offerRescheduleSlots(provider, phone, config, now, booking, true);
    return;
  }

  const oldStartTime = booking.startTime;

  try {
    await prisma.booking.update({
      where: { id: bookingId },
      data: { startTime: newStartTime },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      await offerRescheduleSlots(provider, phone, config, now, booking, true);
      return;
    }
    throw err;
  }

  await prisma.conversation.update({
    where: { clientPhone: phone },
    data: { state: "IDLE", offeredSlots: "{}", offeredAt: null, reschedulingBookingId: null },
  });

  await provider.sendMessage(phone, rescheduleConfirmation(config, newStartTime));
  await notifyTrainerOfReschedule(provider, {
    trainerPhone: config.trainerPhone,
    clientName,
    clientPhone: phone,
    oldStartTime,
    newStartTime,
    timezone: config.timezone,
  });
}

async function offerRescheduleSlots(
  provider: MessagingProvider,
  phone: string,
  config: Config,
  now: Date,
  existingBooking: { id: number; startTime: Date },
  stale: boolean,
): Promise<void> {
  const [rules, blackouts, bookings] = await Promise.all([
    prisma.availabilityRule.findMany(),
    prisma.blackout.findMany(),
    prisma.booking.findMany(),
  ]);

  const slots = generateSlots(rules, blackouts, bookings, config, now);

  if (slots.length === 0) {
    await prisma.conversation.update({
      where: { clientPhone: phone },
      data: { state: "IDLE", offeredSlots: "{}", offeredAt: null, reschedulingBookingId: null },
    });
    await provider.sendMessage(phone, config.noSlotsTemplate);
    return;
  }

  const offered: Record<string, string> = {};
  const lines: string[] = [];
  slots.forEach((slot, idx) => {
    const n = idx + 1;
    offered[String(n)] = slot.start.toISOString();
    lines.push(`${n}. ${formatSlot(slot.start, config.timezone)}`);
  });

  await prisma.conversation.update({
    where: { clientPhone: phone },
    data: {
      state: "AWAITING_RESCHEDULE",
      offeredSlots: JSON.stringify(offered),
      offeredAt: now,
      reschedulingBookingId: existingBooking.id,
    },
  });

  const currentSlotLabel = formatSlot(existingBooking.startTime, config.timezone);
  const header = stale
    ? "Sorry, that slot was just taken. Here are other open slots:"
    : `You have a booking for ${currentSlotLabel}. To reschedule, pick a new slot:`;
  const body = `${header}\n${lines.join("\n")}\nReply with a number to book.`;
  await provider.sendMessage(phone, body);
}

async function offerSlots(
  provider: MessagingProvider,
  phone: string,
  config: Config,
  now: Date,
  stale: boolean,
): Promise<void> {
  const [rules, blackouts, bookings] = await Promise.all([
    prisma.availabilityRule.findMany(),
    prisma.blackout.findMany(),
    prisma.booking.findMany(),
  ]);

  const slots = generateSlots(rules, blackouts, bookings, config, now);

  if (slots.length === 0) {
    await prisma.conversation.update({
      where: { clientPhone: phone },
      data: { state: "IDLE", offeredSlots: "{}", offeredAt: null },
    });
    await provider.sendMessage(phone, config.noSlotsTemplate);
    return;
  }

  const offered: Record<string, string> = {};
  const lines: string[] = [];
  slots.forEach((slot, idx) => {
    const n = idx + 1;
    offered[String(n)] = slot.start.toISOString();
    lines.push(`${n}. ${formatSlot(slot.start, config.timezone)}`);
  });

  await prisma.conversation.update({
    where: { clientPhone: phone },
    data: {
      state: "AWAITING_SELECTION",
      offeredSlots: JSON.stringify(offered),
      offeredAt: now,
    },
  });

  const header = stale
    ? "Sorry, that slot was just taken. Here are fresh open slots:"
    : config.greetingTemplate;
  const body = `${header}\n${lines.join("\n")}\nReply with a number to book.`;
  await provider.sendMessage(phone, body);
}

// Cancellation branch: list this client's upcoming bookings as a numbered
// list (mirroring §6's flow) and put the conversation in
// AWAITING_CANCEL_SELECTION. With no upcoming bookings, reply with a gentle
// "nothing to cancel" and stay IDLE.
async function offerCancellations(
  provider: MessagingProvider,
  phone: string,
  config: Config,
  now: Date,
): Promise<void> {
  const bookings = await prisma.booking.findMany({
    where: { clientPhone: phone, startTime: { gte: now } },
    orderBy: { startTime: "asc" },
  });

  if (bookings.length === 0) {
    await prisma.conversation.update({
      where: { clientPhone: phone },
      data: { state: "IDLE", offeredSlots: "{}", offeredAt: null },
    });
    await provider.sendMessage(
      phone,
      "You have no upcoming bookings to cancel.",
    );
    return;
  }

  const offered: Record<string, string> = {};
  const lines: string[] = [];
  bookings.forEach((b, idx) => {
    const n = idx + 1;
    // Store the booking id (as a string) so the selection step can look it up
    // directly, even if a duplicate clientPhone+startTime ever appeared.
    offered[String(n)] = String(b.id);
    lines.push(`${n}. ${formatSlot(b.startTime, config.timezone)}`);
  });

  await prisma.conversation.update({
    where: { clientPhone: phone },
    data: {
      state: "AWAITING_CANCEL_SELECTION",
      offeredSlots: JSON.stringify(offered),
      offeredAt: now,
    },
  });

  const body = `Your upcoming bookings:\n${lines.join("\n")}\nReply with a number to cancel.`;
  await provider.sendMessage(phone, body);
}

async function handleCancelSelection(
  provider: MessagingProvider,
  phone: string,
  text: string,
  convo: Conversation,
  config: Config,
  now: Date,
): Promise<void> {
  const offered = JSON.parse(convo.offeredSlots) as Record<string, string>;
  const offeredCount = Object.keys(offered).length;

  const match = text.match(/^(\d+)$/);
  const bookingIdStr = match ? offered[match[1]] : undefined;
  if (!bookingIdStr) {
    await provider.sendMessage(phone, reprompt(config, offeredCount));
    return; // state unchanged
  }

  const bookingId = Number(bookingIdStr);
  // Re-check the booking still belongs to this client and is still upcoming
  // (it could have been cancelled by the trainer in the meantime).
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, clientPhone: phone, startTime: { gte: now } },
  });
  if (!booking) {
    await offerCancellations(provider, phone, config, now);
    return;
  }

  await prisma.booking.delete({ where: { id: booking.id } });

  await prisma.conversation.update({
    where: { clientPhone: phone },
    data: { state: "IDLE", offeredSlots: "{}", offeredAt: null },
  });

  await provider.sendMessage(
    phone,
    `Cancelled: ${formatSlot(booking.startTime, config.timezone)}.`,
  );
  await notifyTrainerOfCancellation(provider, {
    trainerPhone: config.trainerPhone,
    clientName: booking.clientName,
    clientPhone: phone,
    startTime: booking.startTime,
    timezone: config.timezone,
  });
}

async function isSlotStillOpen(startTime: Date, now: Date): Promise<boolean> {
  if (startTime.getTime() <= now.getTime()) return false;
  const existing = await prisma.booking.findUnique({ where: { startTime } });
  return existing === null;
}

function reprompt(config: Config, offeredCount: number): string {
  const max = offeredCount > 0 ? offeredCount : config.maxSlotsOffered;
  return config.repromptTemplate.replace("{max}", String(max));
}

function confirmation(config: Config, startTime: Date): string {
  return config.confirmationTemplate.replace(
    "{slot}",
    formatSlot(startTime, config.timezone),
  );
}

function rescheduleConfirmation(config: Config, newStartTime: Date): string {
  return `Rescheduled! ${formatSlot(newStartTime, config.timezone)}. See you then ✅`;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
