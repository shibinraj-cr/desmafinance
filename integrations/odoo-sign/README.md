# Odoo Sign → Desgro Agreements (E-Sign)

Source material for replacing Odoo 18 Sign with an Agreements module at
`/operations/agreements`, and for migrating the existing ~900 Odoo sign
requests into Desgro behind a review-before-live staging step.

| File | What it is |
|---|---|
| `odoo-sign-export.js` | Browser-console script. Run on the Odoo site while logged in as admin. It only reads from Odoo. Downloads `odoo-sign-metadata.json` and `odoo-sign-batch-NNN.zip` files containing the PDFs, signers, audit logs and SHA-256 hashes. Run it with `DRY_RUN: true` first. |
| `import-odoo-sign.mjs` | Node script that checks each zip's hashes again, uploads the PDFs and writes `esign_import_records` rows with status `pending`. It suggests a matching client by email, then phone, then name. |
| `desgro-esign-schema.sql` | Tables for templates, requests, signers, field values, the hash-chained append-only `esign_events`, and import staging. |
| `BUILD_PROMPT.md` | The full module spec: features, rules, build phases and acceptance criteria. |

## ⚠ Stack mismatch — adapt before building

The SQL, the import script and the build prompt were written for
**Supabase** (Postgres + Auth + Storage, `supabase-js`, RLS). Desgro on `main`
does **not** use Supabase:

| Spec assumes | Desgro actually uses |
|---|---|
| Supabase Postgres, raw SQL migration | Neon Postgres via **Prisma** (`prisma/schema.prisma` + `prisma/migrations`) |
| Supabase Storage bucket `agreements` | **Vercel Blob** (private store; serve through an authenticated route) |
| Supabase Auth + RLS policies | **NextAuth** sessions + server-side role/page checks |
| `supabase-js` service-role client | Prisma client (`@/lib/prisma`) |
| Resend | **nodemailer** (existing email setup) |
| "clients" table, `client_id uuid` | `Lead` (CRM) and `Party` (finance); Desgro ids are not uuids |

**Status:** Phase 1 has ported the schema. The live data model is the
`Esign*` models in `prisma/schema.prisma` plus migration
`20261012120000_esign_agreements`, which also installs the audit-trail
triggers. `desgro-esign-schema.sql` is kept only as the original spec. The
import script has not been ported yet; that is Phase 5.

How to adapt each file:

- **Schema:** turn the tables into Prisma models. Keep the `esign_events`
  hash-chain and append-only triggers as raw SQL inside the generated
  migration, because Prisma can't express triggers.
- **Import script:** replace the `sb.storage` calls with `@vercel/blob`
  `put`, and the `sb.from(...)` calls with Prisma.
- **Client matching:** match against `Lead` by email and by the last 10
  digits of the phone number, instead of using the `CLIENTS_TABLE` env vars.

Run the export script in the browser, against Odoo. It works as-is with any
backend.

The `.env` `DATABASE_URL` is the **production** database. Never run the
import or a migration against it without a deliberate decision.
