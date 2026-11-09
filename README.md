# Desma Finance — Web Dashboard

Next.js 14 dashboard for Desma International. Users sign in, record daily transactions
(inflow / outflow), and the dashboards (Overview, Revenue, Expenses, Cash Flow,
Daily Tracker, AI Insights) update automatically.

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS (Material-3 style tokens from the original design)
- NextAuth (credentials / username + password, JWT sessions)
- Prisma ORM + PostgreSQL
- Recharts for visualisations

## Run locally

```bash
cd webapp
cp .env.example .env
# Edit .env: paste a Postgres URL (Vercel Postgres / Neon / Supabase / local)
# Generate a NEXTAUTH_SECRET: openssl rand -base64 32
# Set ADMIN_USERNAME and ADMIN_PASSWORD

npm install
npx prisma db push          # creates the tables
npm run db:seed             # creates the admin user
npm run db:seed-from-excel  # OPTIONAL: imports the original xlsx
npm run dev
```

Visit http://localhost:3000 → you will be redirected to `/login`. Sign in with the
admin credentials from `.env`.

## Deploy to Vercel

1. Push this `webapp/` folder to a GitHub repo.
2. In [Vercel](https://vercel.com/new), import the repo and pick **`webapp`** as the
   project root.
3. Provision a Postgres database — easiest options:
   - **Vercel Postgres** (Storage tab → Create) — `DATABASE_URL` is wired up automatically.
   - **Neon** (https://neon.tech) — free tier, paste the connection string into Vercel
     env vars.
4. Add these environment variables in Vercel → Project → Settings → Environment Variables:
   - `DATABASE_URL` — Postgres connection string (`?sslmode=require`)
   - `NEXTAUTH_SECRET` — `openssl rand -base64 32`
   - `NEXTAUTH_URL` — your Vercel URL, e.g. `https://desma-finance.vercel.app`
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_EMAIL`
5. Deploy. After the first deploy, run the schema push + seed once:

```bash
# from local machine, with DATABASE_URL pointed at the production DB
DATABASE_URL="postgres://…" npx prisma db push
DATABASE_URL="postgres://…" npm run db:seed
# Optional — import the original xlsx into prod:
DATABASE_URL="postgres://…" EXCEL_PATH="/abs/path/file.xlsx" npm run db:seed-from-excel
```

Subsequent deploys run `node scripts/build.mjs` (the `build` script): on
**production** deploys it applies pending migrations with `prisma migrate deploy`
before `prisma generate && next build`, so a schema change ships live in the same
release as the code that needs it. Preview and local builds skip the migration so
a feature-branch migration never touches the production database.

This means committed migrations under `prisma/migrations/` deploy automatically on
the next production release — you no longer need to run `prisma migrate deploy`
from your machine. (You can still run `npm run db:migrate:deploy` manually against
a `DATABASE_URL` if you want to migrate ahead of a deploy.)

## Adding more users

The login uses a Postgres-backed credentials provider. To add another teammate:

```bash
DATABASE_URL="…" ADMIN_USERNAME="meera" ADMIN_PASSWORD="…" ADMIN_EMAIL="meera@…" \
  npm run db:seed
```

Each call upserts one user. (For multi-user management UI, ask Claude to extend
`/settings/users` with create / disable / role flows.)

## Routes

- `/login` — credentials sign-in
- `/overview` — KPIs, revenue services bars, expense donut, monthly trend
- `/revenue` — service mix, top services, MoM growth
- `/expenses` — categories, distribution, recent expenses
- `/cashflow` — inflow/outflow, net cash trend, payment-mode breakdown
- `/daily-tracker` — full transaction table with running balance, type filter
- `/daily-tracker/new` — entry form mirroring the Excel dropdowns
- `/ai-insights` — auto-generated analysis from the data
- `/api/transactions` — `GET` list, `POST` create
- `/api/transactions/[id]` — `DELETE`

## Voxbay call-record webhook

Voxbay (cloud telephony) pushes every finished call, incoming and outgoing, to
DesGro as it ends. This replaces downloading the call report and uploading it on
**Marketing → Voxbay**. That upload still works as a fallback.

- **Endpoint:** `POST https://www.desgro.in/api/crm/voxbay/webhook`. Use the
  `www` host: `desgro.in` redirects to it, and Voxbay doesn't follow redirects.
  It needs no login; each request is authenticated by its `X-Voxbay-Signature` HMAC.
- **Env var:** `VOXBAY_SIGNING_SECRET` is the `whsec_…` signing secret Voxbay shows
  in **API Management**. Set it in Vercel → Project → Settings → Environment
  Variables (Production), then redeploy. Until it is set the endpoint answers
  `503` and files nothing.
- **What it does:** it verifies the signature, then files the call in `VoxbayCall`
  (the table the report upload writes, with `source = 'webhook'`). It links the
  call to the lead with that phone number and adds a Timeline entry with a
  recording link. Test sends (`X-Voxbay-Test: true`) are logged and nothing else.
- **New callers become leads:** an incoming call from a number no lead has
  creates one, with source **Voxbay** and named after the caller (or the
  number). It is assigned to the BDE who answered, through the normal
  assignment, so the notification and WhatsApp intro follow. A missed call's
  lead stays unassigned until someone answers that number or a manager assigns
  it. An outgoing call to an unknown number creates nothing; it is kept with
  `leadUnmatched = true` and filed under the number's lead once there is one.
- **Existing leads calling in:** an incoming call from a number that already
  has a lead is a re-inquiry, whatever its stage: owner and supervisor tasks,
  a lost lead re-opened to Re-marketing, and a notification to the owner and
  the Marketing Admin, as for every re-inquiry. At most once per lead per 24
  hours since its last enquiry, so redialling a busy line raises one.
- **Backfill:** calls filed before this rule existed get their leads from
  `npx tsx prisma/backfill-voxbay-leads.ts`, a dry run until you add `--apply`.
- **Delivery log:** every attempt is a row in `VoxbayWebhookEvent`, with status
  `processed`, `duplicate` (the call was already on file and was refreshed),
  `error` (with the reason) or `test`.
- **Responses:** `200` when the call is filed, is a repeat or is a test. `400` means
  the payload is unusable (for example, no `call_id`), `401` a bad signature,
  `500` a database failure. Voxbay retries anything other than a 2xx at 1m, 5m,
  15m, 1h and 6h.
- **Report upload after the webhook:** a report row for a call the webhook already
  filed doesn't add a second row. It fills in the columns only the report has,
  such as `user_status`, cost and disposition.

### Re-sending failed deliveries

1. In Voxbay, open **API Management → Activity** and find the failed delivery (any
   response that isn't 2xx).
2. Use the response code to fix the cause first:
   - `401`: `VOXBAY_SIGNING_SECRET` doesn't match Voxbay's current secret.
   - `503`: the secret isn't set.
   - `500`: the database was unavailable. The reason is in `VoxbayWebhookEvent.error`.
3. Re-send the delivery from the Activity page. A re-send keeps its event id, so a
   delivery that had already succeeded is answered `200` as a duplicate and the
   call is never filed twice.

### Local testing

Run the dev server against a **local** database, never the `DATABASE_URL` in
`.env`. Give the server and the script the same secret:

```bash
VOXBAY_SIGNING_SECRET=whsec_local npm run dev
VOXBAY_SIGNING_SECRET=whsec_local npx tsx scripts/voxbay-test.ts http://localhost:3000
```

The script sends one signed incoming and one signed outgoing call, then re-sends
the incoming one to show that it comes back as a duplicate. Add `--test` to send
them as Voxbay test sends, which are logged but not filed. Add `--phone <number>`
to use a lead's number, so the calls land on that lead's Timeline.
