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
