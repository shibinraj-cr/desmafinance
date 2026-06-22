// Vercel build entrypoint.
//
// On PRODUCTION deploys only, apply pending Prisma migrations *before* building,
// so a schema change (e.g. a new table) goes live in the same release as the
// code that depends on it. Preview and local builds skip the migration so a
// feature-branch migration can never touch the production database.
//
// Migrations run against a DIRECT (non-pooled) connection: Prisma's migration
// advisory lock (pg_advisory_lock) is session-scoped and hangs over Neon's
// transaction pooler, which made `prisma migrate deploy` intermittently time
// out ("Timed out trying to acquire a postgres advisory lock"). We derive the
// direct URL from DATABASE_URL by dropping the `-pooler` host segment, and use
// it ONLY for migrate deploy — runtime queries still use the pooled URL.
//
// Wired up via package.json: "build": "node scripts/build.mjs".
import { execSync } from "node:child_process";

function run(cmd, extraEnv) {
  console.log(`\n$ ${cmd}`);
  // PATH includes node_modules/.bin because this runs under `npm run build`,
  // so `prisma`/`next` resolve without npx.
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...extraEnv } });
}

/** Neon's direct (unpooled) endpoint = the pooled host minus `-pooler`. No-op if absent. */
function directUrl(url) {
  return url ? url.replace("-pooler", "") : url;
}

const env = process.env.VERCEL_ENV ?? "(local)";
if (process.env.VERCEL_ENV === "production") {
  console.log("[build] VERCEL_ENV=production → applying database migrations (direct connection)");
  run("prisma migrate deploy", { DATABASE_URL: directUrl(process.env.DATABASE_URL) });
} else {
  console.log(`[build] VERCEL_ENV=${env} → skipping migrate deploy (production only)`);
}

run("prisma generate");
run("next build");
