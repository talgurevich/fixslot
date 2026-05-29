import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // All tests share one on-disk SQLite test database. Keep file execution
    // serial so the shared DB is never hit by two workers at once.
    fileParallelism: false,
    env: {
      DATABASE_URL: "file:./test.db",
      MESSAGING_PROVIDER: "fake",
      SESSION_SECRET: "test-secret",
      DASHBOARD_PASSWORD: "test-password",
      TIMEZONE: "Asia/Jerusalem",
    },
    globalSetup: ["./tests/globalSetup.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
