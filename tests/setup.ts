import { beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";

// Start every test from an empty database.
beforeEach(async () => {
  await prisma.booking.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.blackout.deleteMany();
  await prisma.availabilityRule.deleteMany();
  await prisma.config.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
