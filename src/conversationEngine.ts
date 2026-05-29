import type { Config, Conversation } from "@prisma/client";
import { prisma, getConfig } from "./db";
import { MessagingProvider } from "./messaging";
import { generateSlots } from "./slotGenerator";
import { formatSlot } from "./format";
import { notifyTrainerOfBooking } from "./notifier";

export interface InboundOptions {
  now?: Date;
  clientName?: string;
}

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

  if (convo.state === "AWAITING_SELECTION") {
    await handleSelection(provider, phone, text, convo, config, now, clientName);
    return;
  }

  // IDLE or brand-new conversation: offer the next open slots.
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

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
