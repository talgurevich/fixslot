-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "reminderSentAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Config" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slotDurationMinutes" INTEGER NOT NULL DEFAULT 60,
    "bookingHorizonDays" INTEGER NOT NULL DEFAULT 14,
    "maxSlotsOffered" INTEGER NOT NULL DEFAULT 5,
    "trainerPhone" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "greetingTemplate" TEXT NOT NULL DEFAULT 'Hi! Here are the next open slots:',
    "confirmationTemplate" TEXT NOT NULL DEFAULT 'Booked! {slot}. See you then ✅',
    "noSlotsTemplate" TEXT NOT NULL DEFAULT 'Sorry, there are no open times right now — please check back later.',
    "repromptTemplate" TEXT NOT NULL DEFAULT 'Please reply with one of the numbers above, e.g. 1–{max}.',
    "reminderLeadMinutes" INTEGER NOT NULL DEFAULT 1440,
    "reminderTemplate" TEXT NOT NULL DEFAULT 'Reminder: you have a session {slot}. See you then!'
);
INSERT INTO "new_Config" ("bookingHorizonDays", "confirmationTemplate", "greetingTemplate", "id", "maxSlotsOffered", "noSlotsTemplate", "repromptTemplate", "slotDurationMinutes", "timezone", "trainerPhone") SELECT "bookingHorizonDays", "confirmationTemplate", "greetingTemplate", "id", "maxSlotsOffered", "noSlotsTemplate", "repromptTemplate", "slotDurationMinutes", "timezone", "trainerPhone" FROM "Config";
DROP TABLE "Config";
ALTER TABLE "new_Config" RENAME TO "Config";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
