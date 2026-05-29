import express from "express";
import session from "express-session";
import { env } from "./config";
import { getConfig } from "./db";
import { webhookRouter } from "./webhook";
import { dashboardRouter } from "./dashboard/routes";

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
  });
}
