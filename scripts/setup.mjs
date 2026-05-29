// One-command project setup: install deps, prepare the database, and seed it.
// Plain Node + built-ins only, so it runs before dependencies are installed.
import { existsSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  console.log("Created .env from .env.example (offline defaults, no secrets).");
}

run("npm install");
run("npx prisma generate");
run("npx prisma migrate deploy");
run("npx prisma db seed");

console.log("\n✓ Setup complete.");
console.log("  Start the app:   npm run dev   → http://localhost:3000");
console.log("  Run the tests:   npm test");
console.log('  Simulate a chat: npm run sim "hi"');
