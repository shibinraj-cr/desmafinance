// Apply pending migrations to a DISPOSABLE database, and refuse to touch
// production.
//
// Exists because the seed script guards itself and `prisma migrate deploy`
// does not — which left the one genuinely destructive step in the "try this on
// a branch" workflow as the only unguarded one. Pasting the wrong URL there
// migrates production, and a schema change is not something you undo by
// re-running a command.
//
//   DATABASE_URL='postgresql://…' npm run db:migrate:branch
import { execSync } from "node:child_process";

// The production Neon endpoint. Same fragment the seed and verify scripts use.
const PROD_HOST_FRAGMENT = "ep-orange-brook-aqmaow18";

const url = process.env.DATABASE_URL ?? "";

function die(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!url) {
  die(
    "DATABASE_URL is not set.\n\n" +
      "  Create a branch in the Neon console, copy its connection string, then:\n" +
      "  DATABASE_URL='postgresql://…' npm run db:migrate:branch",
  );
}

if (!/^postgres(ql)?:\/\//.test(url)) {
  die(
    `DATABASE_URL is not a connection string — it reads "${url.slice(0, 60)}".\n\n` +
      "  It has to start with postgresql://. If you copied a placeholder out of\n" +
      "  instructions, replace the whole thing with the real URL from Neon.",
  );
}

if (url.includes(PROD_HOST_FRAGMENT)) {
  die(
    "Refusing to run: that is the PRODUCTION endpoint.\n\n" +
      "  Create a branch of it in the Neon console and use that URL instead.\n" +
      "  Production migrations happen on deploy (scripts/build.mjs), not by hand.",
  );
}

// Prisma's migration advisory lock is session-scoped and hangs over Neon's
// transaction pooler, so migrate always runs on the direct endpoint.
const direct = url.replace("-pooler", "");
const shown = direct.replace(/:\/\/[^@]*@/, "://***@");

console.log(`\n▶ Applying migrations to ${shown}\n`);
execSync("prisma migrate deploy", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: direct },
});
console.log("\n✓ Done. Now seed it:  DATABASE_URL='…' npm run db:seed-hiring\n");
