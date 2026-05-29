-- CreateTable
CREATE TABLE "AvailabilityRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Blackout" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientPhone" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientPhone" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'IDLE',
    "offeredSlots" TEXT NOT NULL DEFAULT '{}',
    "offeredAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Config" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slotDurationMinutes" INTEGER NOT NULL DEFAULT 60,
    "bookingHorizonDays" INTEGER NOT NULL DEFAULT 14,
    "maxSlotsOffered" INTEGER NOT NULL DEFAULT 5,
    "trainerPhone" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "greetingTemplate" TEXT NOT NULL DEFAULT 'Hi! Here are the next open slots:',
    "confirmationTemplate" TEXT NOT NULL DEFAULT 'Booked! {slot}. See you then ✅',
    "noSlotsTemplate" TEXT NOT NULL DEFAULT 'Sorry, there are no open times right now — please check back later.',
    "repromptTemplate" TEXT NOT NULL DEFAULT 'Please reply with one of the numbers above, e.g. 1–{max}.'
);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_startTime_key" ON "Booking"("startTime");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_clientPhone_key" ON "Conversation"("clientPhone");
