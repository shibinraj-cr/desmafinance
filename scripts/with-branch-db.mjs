// Run a command against the DISPOSABLE database configured in `.env.branch`.
//
//   npm run db:migrate:branch
//   npm run db:seed-hiring:branch
//   npm run dev:branch
//
// The URL lives in a file rather than in the command, and that is the whole
// point. Every version of this workflow that asked someone to paste a URL into
// a command line got the placeholder pasted instead — twice — because a
// placeholder inside a runnable command does not look like a blank to fill in.
// In a file it does.
//
// Refuses, before the child process starts:
//   - a missing or empty .env.branch
//   - anything that still looks like a placeholder
//   - a string that is not a postgres connection string
//   - the production endpoint
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(process.cwd(), ".env.branch");
const PROD_HOST_FRAGMENT = "ep-orange-brook-aqmaow18";

const SETUP = `
  1. Neon console -> your project -> Branches -> new branch from production.
  2. Copy that branch's connection string.
  3. Put it in .env.branch (this directory), on one line:

       DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

  .env.branch is gitignored. Then run this command again.
`;

function die(message) {
  console.error(`\n✗ ${message}\n${SETUP}`);
  process.exit(1);
}

if (!existsSync(ENV_FILE)) die("There is no .env.branch yet.");

const raw = readFileSync(ENV_FILE, "utf8");
const match = /^\s*DATABASE_URL\s*=\s*["']?([^"'\n#]+)["']?\s*$/m.exec(raw);
const url = match?.[1]?.trim() ?? "";

if (!url) die(".env.branch has no DATABASE_URL line.");

// Placeholder shapes. Every one of these has been pasted for real.
if (/[…<>]|the real one|your-|example\.com|\s/.test(url)) {
  die(`That is still a placeholder, not a URL:\n\n    ${url}`);
}

if (!/^postgres(ql)?:\/\/[^/]+\/.+/.test(url)) {
  die(`That does not look like a connection string:\n\n    ${url}`);
}

if (url.includes(PROD_HOST_FRAGMENT)) {
  die(
    "That is the PRODUCTION endpoint.\n\n" +
      "  Branch it in Neon and use the branch's URL. Production migrations\n" +
      "  happen on deploy (scripts/build.mjs), never by hand.",
  );
}

const [command, ...args] = process.argv.slice(2);
if (!command) die("No command given to run.");

// Prisma's migration advisory lock is session-scoped and hangs over Neon's
// transaction pooler, so anything schema-touching runs on the direct endpoint.
const direct = url.replace("-pooler", "");
console.log(
  `\n▶ ${command} ${args.join(" ")}\n  against ${direct.replace(/:\/\/[^@]*@/, "://***@")}\n`,
);

try {
  execFileSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: direct, DIRECT_URL: direct },
  });
} catch (e) {
  // The child already printed whatever went wrong; a Node stack on top of it
  // just buries the actual error.
  process.exit(typeof e?.status === "number" ? e.status : 1);
}
