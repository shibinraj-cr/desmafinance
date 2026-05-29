# Database migrations

This project historically used `prisma db push`, which syncs the schema to the
database **without a migration history**. For a database holding real financial
and payroll data that's risky: there is no record of *what* changed or *when*,
no review of generated SQL, and no safe rollback when a schema change drifts
from the data.

We've switched to **Prisma Migrate**. A baseline migration captures the current
schema; every future change is a reviewed, versioned SQL file.

## What's here

- `migrations/0_init/migration.sql` — the **baseline**, generated offline from
  `schema.prisma` (it was *not* run against any database). It reflects the
  schema your production DB was already `db push`-ed to.
- `migrations/migration_lock.toml` — pins the provider (`postgresql`).

## One-time: baseline your existing databases

Your production (and any shared dev) database already has these tables, so the
baseline must be marked **as already applied** — never run against an existing
DB, or it will try to `CREATE TABLE` over live data.

For **each** existing database, point `DATABASE_URL` at it and run:

```bash
# 1. (Recommended) Confirm the DB actually matches the schema — output should be empty.
#    This is a read-only diff; it does not modify anything.
DATABASE_URL="postgres://…" \
  npx prisma migrate diff \
    --from-url "$DATABASE_URL" \
    --to-schema-datamodel prisma/schema.prisma \
    --script

# 2. Record the baseline as applied (writes only to the _prisma_migrations table).
DATABASE_URL="postgres://…" npm run db:migrate:baseline
```

If step 1 prints SQL, the live DB has drifted from the schema. Reconcile that
(usually by folding the diff into the baseline or a follow-up migration) **before**
running step 2.

A brand-new/empty database skips all this — just run `npm run db:migrate:deploy`
and the baseline creates everything.

## Going forward

- **Develop a schema change:** edit `schema.prisma`, then
  ```bash
  npm run db:migrate -- --name describe_the_change
  ```
  This creates `migrations/<timestamp>_describe_the_change/` and applies it to
  your local DB. Commit the new folder with your code change.
- **Deploy to prod/CI:** run
  ```bash
  npm run db:migrate:deploy
  ```
  which applies any pending migrations and nothing else (no prompts, no reset).
- **Check state:** `npm run db:migrate:status`.

> Stop using `npm run db:push` against the shared/production database — it
> bypasses the migration history. `db push` is fine only for throwaway local
> experiments.

## Vercel deploys

The `build` script currently runs `prisma generate && next build`. Once every
environment is baselined (above), update the deploy to apply migrations first:

```jsonc
// package.json
"build": "prisma generate && prisma migrate deploy && next build"
```

This change is intentionally **not** applied yet, because it alters deploy
behavior — flip it once the baseline is recorded on every environment.
