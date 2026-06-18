// Vercel build entrypoint.
//
// On PRODUCTION deploys only, apply pending Prisma migrations *before* building,
// so a schema change (e.g. a new table) goes live in the same release as the
// code that depends on it. Preview and local builds skip the migration so a
// feature-branch migration can never touch the production database.
//
// Wired up via package.json: "build": "node scripts/build.mjs".
import { execSync } from "node:child_process";

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  // PATH includes node_modules/.bin because this runs under `npm run build`,
  // so `prisma`/`next` resolve without npx.
  execSync(cmd, { stdio: "inherit" });
}

const env = process.env.VERCEL_ENV ?? "(local)";
if (process.env.VERCEL_ENV === "production") {
  console.log("[build] VERCEL_ENV=production → applying database migrations");
  run("prisma migrate deploy");
} else {
  console.log(`[build] VERCEL_ENV=${env} → skipping migrate deploy (production only)`);
}

run("prisma generate");
run("next build");
