import "dotenv/config";

// Process-level configuration sourced from environment variables.
// Per-trainer settings (timezone, templates, slot sizing) live in the DB Config row;
// this module only covers deployment/runtime wiring.
export const env = {
  messagingProvider: (process.env.MESSAGING_PROVIDER ?? "fake") as "fake" | "greenapi",
  dashboardPassword: process.env.DASHBOARD_PASSWORD ?? "changeme",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-only-not-secret",
  timezone: process.env.TIMEZONE ?? "Asia/Jerusalem",
  port: Number(process.env.PORT ?? 3000),
  greenApi: {
    instance: process.env.GREEN_API_INSTANCE ?? "",
    token: process.env.GREEN_API_TOKEN ?? "",
  },
};
