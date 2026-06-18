# Meta lead-ads → CRM sync

Flows Meta lead-ads leads from the campaign Google Spreadsheet into the CRM
automatically. Each **tab = one campaign**; new rows appear in the CRM within
~1 minute as leads (source **Meta**, the campaign + questionnaire answers kept
in the lead's details).

## How it works

```
Meta Lead Ads → Google Sheet (one tab per campaign)
   → Apps Script (1-min trigger, per-tab cursor)
   → POST /api/integrations/meta-leads  (x-webhook-secret)
   → CRM: map → dedupe (email OR phone) → create Lead (source=Meta, unassigned)
```

- **New leads only** by default (the cursor starts at each tab's current last row).
- **Idempotent**: a stable `externalKey` per row means re-sends are skipped, never
  double-inserted.
- **Duplicate-aware**: a lead whose email *or* phone matches an existing lead is
  created with the **Duplicate** status (not dropped), same as manual/CSV import.
- **Unassigned**: leads arrive without an owner; an admin assigns them in the CRM.
- **Flexible columns**: `Name`/`Full Name`, `Phone`/`Phone Number`, etc. are all
  recognised; any extra columns (qualification, city, adset, etc.) are stored on
  the lead under "details".

## Setup

### 1. CRM side (one-time)
Set an env var in Vercel (Project → Settings → Environment Variables, Production):

```
META_LEADS_WEBHOOK_SECRET = <openssl rand -base64 32>
```

Redeploy so it takes effect. Without it the webhook returns `503 not_configured`.

### 2. Spreadsheet side (one-time)
1. Open the Meta leads spreadsheet → **Extensions → Apps Script**.
2. Paste [`apps-script.gs`](./apps-script.gs), Save.
3. **Project Settings → Script properties**, add:
   - `CRM_WEBHOOK_URL` = `https://www.desgro.in/api/integrations/meta-leads`
   - `CRM_WEBHOOK_SECRET` = the same value as `META_LEADS_WEBHOOK_SECRET`
4. Run **`initBaseline`** once (authorise when prompted) → only new leads sync.
   *(To import the full history instead, run `resetForBackfill` once.)*
5. **Triggers** (clock icon) → Add Trigger → function `syncNewLeads`,
   Time-driven → Minutes timer → **Every minute**.

## Payload contract

`POST /api/integrations/meta-leads` — header `x-webhook-secret: <secret>`

```json
{
  "campaign": "GF | Kerala | May 2026 - 2",
  "rows": [
    { "Date": "2026-05-27T05:47:32+0000", "Name": "...", "Email": "...", "Phone": 919876543210,
      "What is your qualification?": "bsn", "City": "ktm", "Campaign Name": "..." }
  ]
}
```

Response:

```json
{ "received": 12, "inserted": 9, "duplicatesFlagged": 2, "skippedAlreadyImported": 1, "errorRows": 0 }
```

- `inserted` — new leads created
- `duplicatesFlagged` — created but marked **Duplicate** (email/phone already on file)
- `skippedAlreadyImported` — this exact row was ingested before (idempotent)
- `errorRows` — rows with no candidate name

Max 500 rows/request (the script sends in 200-row chunks).

## Testing the webhook manually

```bash
curl -X POST https://www.desgro.in/api/integrations/meta-leads \
  -H "x-webhook-secret: $META_LEADS_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{"campaign":"Test","rows":[{"Name":"Test Lead","Email":"t@example.com","Phone":"9876543210"}]}'
```

## Notes / future
- The Apps Script reads cell **values** (not display text) so phone numbers keep
  full digits despite the sheet's scientific-notation formatting.
- Campaign → CRM **service** is left blank on import (campaigns are nursing/GCC
  but mapping isn't 1:1); set it per-lead, or ask to add a campaign→service map.
- Adding a new campaign tab needs no changes — it syncs automatically.
