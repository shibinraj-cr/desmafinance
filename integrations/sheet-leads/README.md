# Lead spreadsheets → CRM sync

Auto-flows leads from Google Spreadsheets into the CRM. One generic webhook +
Apps Script serves every source — today **Meta lead-ads** and the **Website/SEO
form**, and any future source by adding a small config entry. New rows appear in
the CRM within ~1 minute.

## How it works

```
Spreadsheet (Meta tabs = campaigns, or the Website form sheet)
   → Apps Script (1-min trigger, per-tab cursor, sends `source`)
   → POST /api/integrations/sheet-leads   (x-webhook-secret)
   → CRM: map columns (per source) → dedupe (email OR phone)
        → create Lead (correct source, unassigned, original lead date)
```

- **New leads only** by default; **idempotent** (stable `externalKey` → re-sends skipped).
- **Duplicate-aware**: a lead whose email *or* phone matches an existing one is
  created with the **Duplicate** status (not dropped).
- **Unassigned**: an admin assigns in the CRM.
- **Flexible columns** per source: Meta's `Name`/`Full Name`/`Phone`; the
  Website form's Contact-Form-7 tags `your-name`/`your-email`/`phonetext-354`.
  Any extra columns (questionnaire answers, message, the sheet's own
  Status/Feedback/Assigned-to, etc.) are kept on the lead under "details".

## Supported sources

| `CRM_SOURCE` | CRM source | Column conventions |
|---|---|---|
| `meta`    | Meta    | `Name`/`Full Name`, `Email`, `Phone`/`Phone Number`, `Date` (+ campaign/adset/questionnaire) |
| `website` | Website | `your-name`, `your-email`, `phonetext-354`, `date` (+ `your-message`, `select-*`, etc.) |

Add a source by adding an entry to `SHEET_SOURCES` in `src/lib/crm-sheet-ingest.ts`.

## Setup

Everything except pasting the script into Google is done **in the CRM**:
**Settings → Integrations** (admin). That page generates the secret, shows the
webhook URL, the per-source column mappings, the Apps Script to copy, and a
recent-syncs log.

### 1. CRM side (one-time)
CRM → **Settings → Integrations** → **Generate secret** (stored in the DB). Copy
the **webhook URL** and **secret** shown there.

> Alternatively (env-only setup) set `SHEET_LEADS_WEBHOOK_SECRET` in Vercel and
> redeploy — the webhook prefers the in-app value and falls back to the env var.

### 2. Each spreadsheet (one-time)
Do this **once per spreadsheet** (Meta sheet, Website sheet):

1. **Extensions → Apps Script** → paste the script from the CRM Integrations page
   (canonical source: [`src/lib/sheet-leads-apps-script.ts`](../../src/lib/sheet-leads-apps-script.ts)) → Save.
2. **Project Settings → Script properties**:
   - `CRM_WEBHOOK_URL` = the URL from the Integrations page (`…/api/integrations/sheet-leads`)
   - `CRM_WEBHOOK_SECRET` = the secret from the Integrations page
   - `CRM_SOURCE` = `meta` (Meta sheet) **or** `website` (Website sheet)
3. Run **`initBaseline`** once (authorise when asked) → only new leads sync.
   *(Run `resetForBackfill` instead to import the whole sheet.)*
4. **Triggers** (clock) → Add Trigger → `syncNewLeads`, Time-driven → Every minute.

## Payload contract

`POST /api/integrations/sheet-leads` — header `x-webhook-secret: <secret>`

```json
{
  "source": "website",
  "campaign": "Sheet1",
  "rows": [
    { "date": "October 14, 2025", "your-name": "...", "your-email": "...",
      "phonetext-354": "98765...", "your-message": "...", "select-857": "..." }
  ]
}
```

Response: `{ "received": 12, "inserted": 9, "duplicatesFlagged": 2, "skippedAlreadyImported": 1, "errorRows": 0 }`

Max 500 rows/request (the script sends in 200-row chunks).

## Test manually

```bash
curl -X POST https://www.desgro.in/api/integrations/sheet-leads \
  -H "x-webhook-secret: $SHEET_LEADS_WEBHOOK_SECRET" -H "content-type: application/json" \
  -d '{"source":"website","campaign":"Test","rows":[{"your-name":"Test","your-email":"t@example.com","phonetext-354":"9876543210"}]}'
```

## Notes
- The Apps Script reads cell **values** (not display text) so phone numbers keep
  full digits despite scientific-notation formatting.
- **Service** is left blank on import; set per-lead, or ask to add a
  campaign/source → service map.
- The Website sheet has an **"Assigned to"** column; it's currently stored under
  the lead's details (leads arrive unassigned). Ask if you want it auto-mapped to
  the matching BDE.
