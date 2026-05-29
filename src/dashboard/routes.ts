import { Router } from "express";
import { prisma, getConfig } from "../db";
import { env } from "../config";
import { FakeProvider } from "../messaging";
import { handleInbound } from "../conversationEngine";
import { requireAuthApi, requireAuthPage } from "./auth";
import { renderDashboard, renderLogin } from "./page";

export const dashboardRouter = Router();

// --- Auth + pages ---------------------------------------------------------

dashboardRouter.get("/login", (req, res) => {
  if (req.session.authed) return res.redirect("/");
  res.type("html").send(renderLogin(req.query.error === "1"));
});

dashboardRouter.post("/login", (req, res) => {
  if ((req.body?.password ?? "") === env.dashboardPassword) {
    req.session.authed = true;
    return res.redirect("/");
  }
  res.redirect("/login?error=1");
});

dashboardRouter.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

dashboardRouter.get("/", requireAuthPage, (_req, res) => {
  res.type("html").send(renderDashboard());
});

// --- Config / settings ----------------------------------------------------

dashboardRouter.get("/api/config", requireAuthApi, async (_req, res) => {
  res.json(await getConfig());
});

dashboardRouter.post("/api/config", requireAuthApi, async (req, res) => {
  const b = req.body ?? {};
  const config = await getConfig();
  const updated = await prisma.config.update({
    where: { id: config.id },
    data: {
      slotDurationMinutes: toInt(b.slotDurationMinutes, config.slotDurationMinutes),
      bookingHorizonDays: toInt(b.bookingHorizonDays, config.bookingHorizonDays),
      maxSlotsOffered: toInt(b.maxSlotsOffered, config.maxSlotsOffered),
      trainerPhone: toStr(b.trainerPhone, config.trainerPhone),
      timezone: toStr(b.timezone, config.timezone),
      greetingTemplate: toStr(b.greetingTemplate, config.greetingTemplate),
      confirmationTemplate: toStr(b.confirmationTemplate, config.confirmationTemplate),
      noSlotsTemplate: toStr(b.noSlotsTemplate, config.noSlotsTemplate),
      repromptTemplate: toStr(b.repromptTemplate, config.repromptTemplate),
    },
  });
  res.json(updated);
});

// --- Availability rules ----------------------------------------------------

dashboardRouter.get("/api/availability", requireAuthApi, async (_req, res) => {
  res.json(
    await prisma.availabilityRule.findMany({
      orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
    }),
  );
});

// Replace the full set of weekly rules in one call.
dashboardRouter.put("/api/availability", requireAuthApi, async (req, res) => {
  const rules = Array.isArray(req.body?.rules) ? req.body.rules : [];
  const clean = [];
  for (const r of rules) {
    const weekday = toInt(r.weekday, -1);
    const startTime = toStr(r.startTime, "");
    const endTime = toStr(r.endTime, "");
    if (weekday < 0 || weekday > 6 || !isHHMM(startTime) || !isHHMM(endTime)) {
      return res.status(400).json({ error: `invalid rule: ${JSON.stringify(r)}` });
    }
    clean.push({ weekday, startTime, endTime });
  }
  await prisma.$transaction([
    prisma.availabilityRule.deleteMany(),
    prisma.availabilityRule.createMany({ data: clean }),
  ]);
  res.json(
    await prisma.availabilityRule.findMany({
      orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
    }),
  );
});

// --- Blackout dates --------------------------------------------------------

dashboardRouter.get("/api/blackouts", requireAuthApi, async (_req, res) => {
  res.json(await prisma.blackout.findMany({ orderBy: { date: "asc" } }));
});

dashboardRouter.post("/api/blackouts", requireAuthApi, async (req, res) => {
  const b = req.body ?? {};
  const date = toStr(b.date, "");
  if (!isYYYYMMDD(date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }
  const startTime = b.startTime ? toStr(b.startTime, "") : null;
  const endTime = b.endTime ? toStr(b.endTime, "") : null;
  if ((startTime && !isHHMM(startTime)) || (endTime && !isHHMM(endTime))) {
    return res.status(400).json({ error: "times must be HH:MM" });
  }
  const created = await prisma.blackout.create({ data: { date, startTime, endTime } });
  res.status(201).json(created);
});

dashboardRouter.delete("/api/blackouts/:id", requireAuthApi, async (req, res) => {
  const id = Number(req.params.id);
  await prisma.blackout.deleteMany({ where: { id } });
  res.sendStatus(204);
});

// --- Bookings (read-only for MVP) -----------------------------------------

dashboardRouter.get("/api/bookings", requireAuthApi, async (_req, res) => {
  const bookings = await prisma.booking.findMany({
    where: { startTime: { gte: new Date() } },
    orderBy: { startTime: "asc" },
  });
  res.json(bookings);
});

// --- Dev-only conversation simulator --------------------------------------
// Runs an inbound message through the engine with a throwaway in-memory provider
// and returns the bot's replies, so the conversation flow can be exercised in
// the browser with no phone and no credentials. Mirrors `npm run sim`.
dashboardRouter.post("/api/dev/sim", requireAuthApi, async (req, res) => {
  const phone = toStr(req.body?.phone, "972500000000");
  const text = toStr(req.body?.text, "");
  const name = toStr(req.body?.name, "Dev Tester");
  const fake = new FakeProvider();
  await handleInbound(fake, phone, text, { clientName: name });
  res.json({ replies: fake.sent });
});

// --- helpers ---------------------------------------------------------------

function toInt(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toStr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function isHHMM(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function isYYYYMMDD(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
