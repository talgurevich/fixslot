import express from "express";
import session from "express-session";
import { env } from "./config";
import { getConfig } from "./db";
import { webhookRouter } from "./webhook";
import { dashboardRouter } from "./dashboard/routes";
import { getProvider } from "./messaging";
import { runRemindersOnce } from "./reminders";

// How often the reminder scheduler ticks. A plain setInterval is enough for an
// MVP with a single trainer: the lead time is hours, so a 60s cadence is far
// finer than the precision anyone cares about. If this ever needs cron-grade
// reliability, swap this for node-cron or an external scheduler.
const REMINDER_TICK_MS = 60_000;

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: env.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 },
    }),
  );

  app.use(webhookRouter);
  app.use(dashboardRouter);

  return app;
}

// Start the server only when run directly (not when imported by tests).
if (require.main === module) {
  const app = createApp();
  app.listen(env.port, async () => {
    await getConfig(); // ensure the single Config row exists
    console.log(`fixslot listening on http://localhost:${env.port}`);
    console.log(`Messaging provider: ${env.messagingProvider}`);

    const provider = getProvider();
    const tick = () =>
      runRemindersOnce(provider, {}).catch((err) =>
        console.error("[reminders] tick failed:", err),
      );
    void tick(); // catch any bookings already inside the lead window at boot
    setInterval(tick, REMINDER_TICK_MS).unref();
    console.log(`Reminders: ticking every ${REMINDER_TICK_MS / 1000}s`);
  });
}
