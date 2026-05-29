import { DateTime } from "luxon";
import { prisma } from "../src/db";
import { generateSlots, SlotBlackout } from "../src/slotGenerator";

// Seed availability + a few confirmed bookings so the dashboard isn't empty and
// the (intentionally missing) features have real data to act on. Idempotent:
// re-running resets the seeded data.
async function main() {
  await prisma.booking.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.blackout.deleteMany();
  await prisma.availabilityRule.deleteMany();
  await prisma.config.deleteMany();

  const timezone = "Asia/Jerusalem";

  await prisma.config.create({
    data: {
      slotDurationMinutes: 60,
      bookingHorizonDays: 14,
      maxSlotsOffered: 5,
      trainerPhone: "972540000000",
      timezone,
    },
  });

  // Sun–Thu mornings, plus Mon & Wed evenings (0 = Sun .. 6 = Sat).
  const rules = [
    { weekday: 0, startTime: "09:00", endTime: "12:00" },
    { weekday: 1, startTime: "09:00", endTime: "12:00" },
    { weekday: 2, startTime: "09:00", endTime: "12:00" },
    { weekday: 3, startTime: "09:00", endTime: "12:00" },
    { weekday: 4, startTime: "09:00", endTime: "12:00" },
    { weekday: 1, startTime: "16:00", endTime: "19:00" },
    { weekday: 3, startTime: "16:00", endTime: "19:00" },
  ];
  await prisma.availabilityRule.createMany({ data: rules });

  // Block a date about a week out (whole day) as an example.
  const blackoutDate = DateTime.now().setZone(timezone).plus({ days: 7 }).toFormat("yyyy-MM-dd");
  const blackouts: SlotBlackout[] = [{ date: blackoutDate, startTime: null, endTime: null }];
  await prisma.blackout.create({ data: { date: blackoutDate, startTime: null, endTime: null } });

  // Book a few real upcoming slots so the bookings list is populated and those
  // slots stop being offered.
  const now = new Date();
  const slots = generateSlots(
    rules,
    blackouts,
    [],
    { slotDurationMinutes: 60, bookingHorizonDays: 14, maxSlotsOffered: 100, timezone },
    now,
  );

  const clients = [
    { clientName: "Dana Levi", clientPhone: "972501112233" },
    { clientName: "Yossi Cohen", clientPhone: "972502223344" },
    { clientName: "Maya Bar", clientPhone: "972503334455" },
  ];

  const picks = [slots[1], slots[4], slots[8]].filter(Boolean);
  for (let i = 0; i < picks.length && i < clients.length; i++) {
    await prisma.booking.create({
      data: { ...clients[i], startTime: picks[i].start },
    });
  }

  console.log(
    `Seeded: ${rules.length} availability rules, 1 blackout (${blackoutDate}), ${picks.length} bookings.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
