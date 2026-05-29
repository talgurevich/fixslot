import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Single shared Prisma client for the whole app.
export const prisma = new PrismaClient();

// Returns the single Config row, creating it with defaults if missing.
export async function getConfig() {
  const existing = await prisma.config.findFirst();
  if (existing) return existing;
  return prisma.config.create({ data: {} });
}
