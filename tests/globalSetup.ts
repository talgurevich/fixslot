import { execSync } from "node:child_process";

// Build a fresh schema in the test database once before the whole suite runs.
// Uses `db push` (not migrations) for speed; the same DATABASE_URL is given to
// the workers via vitest.config.ts so they connect to this same file.
export default function setup() {
  const DATABASE_URL = "file:./test.db";
  execSync("npx prisma db push --force-reset --skip-generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL },
  });
}
