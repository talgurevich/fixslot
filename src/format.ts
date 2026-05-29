import { DateTime } from "luxon";

// Human-friendly slot label in the trainer's timezone, e.g. "Mon 28 Jul, 09:00".
export function formatSlot(when: Date, timezone: string): string {
  return DateTime.fromJSDate(when, { zone: timezone }).toFormat("ccc d LLL, HH:mm");
}
