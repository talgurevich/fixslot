import { MessagingProvider } from "./messaging";
import { formatSlot } from "./format";

export interface BookingNotification {
  trainerPhone: string;
  clientName: string;
  clientPhone: string;
  startTime: Date;
  timezone: string;
}

export interface RescheduleNotification {
  trainerPhone: string;
  clientName: string;
  clientPhone: string;
  oldStartTime: Date;
  newStartTime: Date;
  timezone: string;
}

// Notify the trainer of a new booking over WhatsApp (spec §10). The dashboard
// entry is created by the booking write itself; this covers the message side.
export async function notifyTrainerOfBooking(
  provider: MessagingProvider,
  n: BookingNotification,
): Promise<void> {
  if (!n.trainerPhone) return; // no trainer number configured yet
  const slot = formatSlot(n.startTime, n.timezone);
  const text = `New booking: ${n.clientName} (${n.clientPhone}) — ${slot}`;
  await provider.sendMessage(n.trainerPhone, text);
}

export async function notifyTrainerOfReschedule(
  provider: MessagingProvider,
  n: RescheduleNotification,
): Promise<void> {
  if (!n.trainerPhone) return;
  const oldSlot = formatSlot(n.oldStartTime, n.timezone);
  const newSlot = formatSlot(n.newStartTime, n.timezone);
  const text = `Rescheduled: ${n.clientName} (${n.clientPhone}) moved from ${oldSlot} → ${newSlot}`;
  await provider.sendMessage(n.trainerPhone, text);
}
