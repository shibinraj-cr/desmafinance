# Bank Statement Automation

Finance → **Bank Statements** (`/finance/bank-statements`). Every day DesGro reads the
bank's statement e-mail from Gmail, opens the secure statement link in headless
Chromium, enters the statement password, archives the original PDF privately,
extracts every transaction, validates the balances, and stores each transaction
once — ready for reconciliation against the ledger.

First bank: **HDFC SmartStatement**. Each bank account is one `BankIntegration` row;
another account is a new row, another bank is a parser + downloader added under
`src/lib/bank/`.

```
Gmail (read-only) ─▶ statement e-mail ─▶ SmartStatement link (host-allowlisted, sealed)
      │                                            │
      │                         headless Chromium: password → PDF
      │                                            │
      ▼                                            ▼
BankStatementRun (job) ──▶ BankStatement ──▶ private Blob archive (SHA-256)
                                │
                     pdf.js (in memory, password-aware) ─▶ HDFC parser (2 strategies)
                                │
                        validation (balances, totals, account, period)
                         │                         │
                   pass ▼                   fail ▼
         BankTransaction (unique hash)   REVIEW_REQUIRED (rows held, nothing imported)
                         │
              optional Google Sheet copy
```

## Upload & consolidate (no setup needed)

Bank Statements → **Consolidated** (the first tab, and the whole page before any account
exists). Drop one or many statement PDFs — daily, monthly, any order, overlapping is fine.
For each file DesGro reads the bank and account number off the PDF (creating the account on
first sight, automation off), archives it, parses and validates it, and imports it through the
same duplicate guards as the daily run. Each file reports *N new · M already present*. A
password-protected PDF asks for its password, which is used for that upload only and never
stored.

The consolidated statement is every imported transaction for the account in date order, with
opening balance, total credits/debits, closing balance, Excel/CSV download and print. It also
says whether the ledger is complete: **coverage gaps** (days no uploaded statement covers) and
**balance breaks** (a row whose balance does not follow from the previous one — transactions
missing between two statements). The transaction hash ignores whitespace and leading zeros in
references, so the same day read from a daily e-mail and a monthly net-banking PDF matches.

## Where things live

| Concern | Code |
| --- | --- |
| Job runner, retries, scheduler, backfill, test mode | `src/lib/bank/engine.ts` |
| Gmail OAuth + search | `src/lib/bank/gmail.ts`, `src/lib/bank/email-parse.ts` |
| SmartStatement browser flow | `src/lib/bank/downloaders/hdfc.ts`, `src/lib/bank/browser.ts` |
| PDF open/extract | `src/lib/bank/pdf.ts` |
| Parsers (`BaseBankStatementParser`, `HDFCStatementParser`) | `src/lib/bank/parsers/` |
| Validation / dedupe hash / import | `validate.ts`, `hash.ts`, `import.ts` |
| Secrets (AES-256-GCM) + log redaction | `src/lib/bank/secrets.ts` |
| RBAC | `src/lib/bank/access.ts` |
| Alerts (bell) | `src/lib/bank/notify.ts` |
| Sheets export | `src/lib/bank/sheets.ts` |
| Worker cron (every 5 min) | `src/app/api/cron/bank-statements/route.ts` |
| UI | `src/app/(app)/finance/bank-statements/` |

## Reconciliation

Bank Statements → **Reconciliation** ties each bank line to the Finance ledger
(`src/lib/bank/reconcile.ts` rules, `reconcile-run.ts` against the DB).

- **Automatic, only when certain**: a line is matched without a person only when one ledger
  entry carries its payment reference (UTR / UPI RRN / NEFT ref, compared without punctuation or
  leading zeros) **and** exactly its open amount, and no other bank line carries that reference.
  Only payment ids count: phone numbers, masked accounts, loan numbers, PAN, GSTIN and IFSC never do. It runs after every statement import and on
  **Match now**, over unmatched lines of the last 120 days. The line is marked *auto*.
- **Suggestions** (Reconcile dialog): every candidate is scored from named signals — exact
  amount 40, reference 40, same day 15 / 1 day 10 / ≤3 days 5, the payee's name in the
  narration 15, booked against this bank 10 (another bank −30) — and the reasons are shown.
  One click on **Match** ties it.
- **One payment, two transfers**: a ledger entry can be tied to several bank lines; the
  second transfer is offered as "exactly what is still open". No entry can be matched for more
  than its amount across bank lines.
- **Transfers between DesGro's accounts** (HDFC ↔ Axis): a debit in one account and a credit
  of the same amount in another within 3 days. Paired automatically when both legs carry the
  same reference; otherwise suggested ("Pair as transfer"). Status `TRANSFER`, each leg points
  at the other (`transferPairId`); **Unpair** frees both. Transfers need no ledger entry.
- **Test credits**: "Ignore N test credits" sets aside every unmatched credit of ₹10 or less.
- **Create entry from this line**: for EPFO, ESIC, TDS, salaries, charges, a loan EMI. Date,
  amount and bank come from the line; category, sub-item and payee are prefilled from how the
  same kind of line (same narration shape) was booked before. It goes through the Daily
  Tracker's validation and approval routing; posted at once, it is matched to the line.
- **Months**: per account and month, explained lines (matched in full, ignored, transfer) out of
  all lines and the bank's closing balance. A month with every line explained reads
  *Reconciled*.

A person's decision always stands: the engine only touches `UNMATCHED` lines no person has
touched (`reconciledById` null), so an unmatch or unpair is never redone. Writes take locks in one
order — the bank line, then ledger entries by id — and the manual reconcile route runs as one
transaction under those locks.

## Duplicate protection

1. **E-mail** — `@@unique([integrationId, gmailMessageId])`. A message already processed is skipped before anything is downloaded.
2. **Statement** — `@@unique([integrationId, fileSha256])`. A byte-identical PDF (re-sent e-mail) is marked `DUPLICATE`.
3. **Transaction** — `@@unique([integrationId, transactionHash])`, SHA-256 of account + dates + normalised narration + reference + debit + credit + **running balance**; inserts use `skipDuplicates`. The balance keeps two genuine same-amount payments apart while the same line read twice collides.

Running the same run or backfill again creates **zero** new rows.

## Statuses

Statement: `NEW → EMAIL_FOUND → DOWNLOADING → PDF_DOWNLOADED → PARSING → PROCESSED | NO_TRANSACTIONS`,
or `REVIEW_REQUIRED` (validation failed — rows held, not imported), `FAILED`,
`MANUAL_ACTION_REQUIRED` (password / CAPTCHA / OTP / expired link / config), `DUPLICATE`.

Run: `QUEUED → RUNNING → COMPLETED | COMPLETED_WITH_ERRORS | NO_NEW | FAILED`.

## Retry policy

| Failure | Behaviour |
| --- | --- |
| Network / Gmail / storage error | up to 3 attempts, backoff 5 → 10 min |
| Browser timeout | up to 3 attempts (2 retries) |
| Parse failure | the fallback parser runs inside the same attempt; then `FAILED` |
| Wrong password, CAPTCHA/OTP, expired link, missing config | `MANUAL_ACTION_REQUIRED`, **never** retried automatically |
| Bank page layout changed | `FAILED`, nothing imported |

Every failure raises a bell notification for Admins and for approver roles granted the page.

## Configuration

### Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Required | Purpose |
| --- | --- | --- |
| `HDFC_STATEMENT_PASSWORD` | yes* | The SmartStatement / PDF password. *Or set it in the UI (stored sealed in the DB). |
| `BANK_GOOGLE_CLIENT_ID`, `BANK_GOOGLE_CLIENT_SECRET` | yes | Google OAuth client for Gmail (falls back to `YOUTUBE_CLIENT_ID/SECRET`). |
| `BANK_SECRETS_KEY` | recommended | Key for sealing secrets at rest. Falls back to an HKDF of `NEXTAUTH_SECRET`. Rotating it invalidates stored secrets (UI asks to re-enter / reconnect). |
| `BLOB_READ_WRITE_TOKEN` | yes | Private Blob store for archived PDFs (already set for Finance Documents). |
| `CRON_SECRET` | yes | Authenticates the 5-minute worker cron (already set). |
| `BANK_CHROMIUM_PATH` | local only | Chrome/Chromium binary for local runs (macOS Chrome is auto-detected). |

Never put the password in source, `.env` files that are committed, or the UI anywhere it can be read back — the UI is write-only.

### Gmail OAuth (one-time)

1. Google Cloud console → the project used for DesGro → **APIs & Services → Library**: enable **Gmail API** (and **Google Sheets API** if syncing to a sheet).
2. **OAuth consent screen**: user type **Internal** (Workspace domain). `gmail.readonly` is a restricted scope — an External app in Testing mode has its refresh token expire after 7 days and the import silently stops.
3. **Credentials → OAuth client ID → Web application**. Authorised redirect URI:
   `https://<your-domain>/api/finance/bank-automation/gmail/callback`
4. Set `BANK_GOOGLE_CLIENT_ID` / `BANK_GOOGLE_CLIENT_SECRET` (or reuse the YouTube client and just add the redirect URI).
5. In DesGro: Bank Statements → **Automation** → **Connect Gmail**, signing in as the mailbox that receives the statements. Any other account is refused.

Scopes requested: `openid email gmail.readonly` (+ `spreadsheets` only when Sheets sync is on). DesGro never modifies, labels or deletes mail.

### Browser (Playwright) on Vercel

`playwright-core` + `@sparticuz/chromium` (a Chromium build packed for serverless). Both are
`serverComponentsExternalPackages`, and `next.config.mjs` traces the browser binary and the
whole of `playwright-core` into exactly the routes that may launch it (cron, run, backfill,
test, retry, upload). Functions run up to 300 s (Vercel Pro). Each statement gets a fresh
browser context that is closed afterwards — no cookies or bank session persist.

### Scheduler

`vercel.json` runs `/api/cron/bank-statements` every 5 minutes. On each tick it:
queues the day's scheduled run once the configured time (default **09:30 Asia/Kolkata**) has
passed, raises the "no statement for N business days" alert (default 2; Sundays and 2nd/4th
Saturdays are not business days), and advances any queued/running runs. "Run now",
backfills and retries also continue in the background of their own request (`waitUntil`),
so the cron is the safety net, not the only worker.

Settings (Automation tab): enable/pause, execution time, lookback days (default 3 — catches a
late e-mail), alert threshold, browser automation, PDF archive, failure screenshots (off by
default — screenshots may show transactions), Sheets target.

### HDFC settings

Prefilled when the account is added:

- Sender: `hdfcbanksmartstatement@hdfcbank.bank.in` (exact match)
- Subject contains: `Email Account Statement of your HDFC Bank Account ***<last-4> for the period`
- Statement links are only ever opened on `smartstatements.hdfc.bank.in` / `smartstatement(s).hdfcbank.com` over HTTPS — a look-alike link in a spoofed e-mail is ignored.

### Google Sheets (optional)

Automation → Settings → **Sync to Google Sheets**, paste the sheet URL or ID, choose a tab
(created if missing), then **Reconnect** Gmail with Sheets access. Columns: Txn Date, Value
Date, Description, Reference / Cheque No., Debit, Credit, Balance, Statement Date, Gmail
Message ID, Source Subject, DESGRO Transaction ID, Transaction Hash. Rows whose hash is
already in the sheet are never appended again.

## RBAC

| Capability | Who |
| --- | --- |
| View transactions & statements, download PDFs | Roles granted the **Bank Statements** page |
| Reconcile | …and the role posts without approval (`canApprove` or `needsApproval` off) |
| Manage automation (run, backfill, settings, password, Gmail, review) | …and the role can approve, or Admin |

The page is **not** ticked by default for new roles and is not added by the role page-sync to
existing ones — grant it deliberately in Role Management.

## Running locally

```
npm ci
export HDFC_STATEMENT_PASSWORD=…  BANK_GOOGLE_CLIENT_ID=…  BANK_GOOGLE_CLIENT_SECRET=…
npm run dev        # Chrome is auto-detected for the browser step
npm test           # parser, engine acceptance, dedupe, RBAC, Sheets
BANK_BROWSER_TESTS=1 npx vitest run tests/bank-downloader.browser.test.ts   # real Chrome vs a mock bank page
```

The `.env` `DATABASE_URL` points at production — do not run migrations or the worker against it locally.

## Deploying

Merge to `main`; Vercel builds and `scripts/build.mjs` applies the migration
`20261007120000_bank_statement_automation` (additive: 8 new tables + one FK to `Transaction`).
Then: set the env vars above, grant the page to the right roles, add the account
(Bank Statements → Add account), connect Gmail, set the password, and **Test**.

## Testing the automation

1. Automation → **Test Gmail** — mailbox reachable; count of statement e-mails in 30 days; latest has a link.
2. **Test HDFC statement access** — Gmail → latest e-mail → link → bank page → PDF → parse → preview (statement date, count, totals, closing balance). **Writes nothing.**
3. **Run now** — imports any e-mail in the lookback window; watch the live log.
4. Run now again — expect "No new statement found".

## First production backfill (from 1 Oct 2026)

Never automatic. Automation → **Backfill** → From `01-Oct-2026`, To today → **Run backfill**.
Statements are processed oldest first with per-day progress; a failed day does not stop the
rest. Running it again imports nothing new.

## Retrying

Statements tab → **Retry** on a row, or **Retry failed** for all `FAILED` /
`MANUAL_ACTION_REQUIRED`. A statement whose PDF is already archived is re-parsed from the
archive (the e-mailed link may have expired). Fix the cause first for manual-action
failures (update the password; for CAPTCHA/OTP or an expired link, download the PDF from
net banking and use **Upload PDF**). `REVIEW_REQUIRED`: open **Review** → check the held rows
→ **Approve & import**, **Reject**, or **Re-parse**.

## Security checklist

- [x] No statement password in source, frontend bundle, logs, events, API responses or DB plaintext (env secret, or AES-256-GCM sealed; UI write-only).
- [x] Gmail refresh token sealed at rest; never selected into a response or the client.
- [x] SmartStatement links sealed at rest; host allowlist; HTTPS only.
- [x] Fresh browser context per statement; nothing persisted.
- [x] PDFs in the private Blob store only; served by an authenticated, audited route.
- [x] Encrypted PDFs decrypted in memory only — no temporary decrypted files.
- [x] Every stored/logged error passes the redactor (password, bearer/OAuth tokens, cookies, job keys, query strings).
- [x] CAPTCHA / OTP / bot checks are never bypassed.
- [x] API authorisation on every route (`requireBank`); cron fail-closed on `CRON_SECRET`.
- [x] No bank data sent to any AI or third-party API (Google only for the mailbox and the optional sheet).

## Rollback

1. Pause automation (Automation → Pause) — stops scheduled runs immediately.
2. Revert the merge commit on `main` and redeploy. The tables can stay; nothing else reads them.
3. To remove the data entirely: drop `BankTransactionMatch`, `BankTransaction`, `BankAutomationEvent`,
   `BankStatement`, `BankStatementRun`, `BankIntegrationSecret`, `BankIntegration`,
   `BankMailboxConnection` (in that order) and delete the `bank-statements/` Blob prefix. Revoke the
   Google grant from the Google account's third-party access page.

## Known limitations

- The HDFC page flow and PDF layout were built from the published layout without a live statement; the first **Test** against the real account is the real verification. The downloader fails safe (`PAGE_CHANGED` with a value-free page outline) and the parser holds anything inconsistent for review.
- Image-only (scanned) PDFs are not OCR'd — they fail as `PARSE_FAILED`; upload a text PDF instead.
- Bank holidays are not modelled beyond Sundays and 2nd/4th Saturdays; the alert threshold absorbs single holidays.
- Gmail search is day-granular; the 3-day lookback covers late e-mails.
- Reconciliation is manual in v1 (suggestions by amount and date; no automatic matching).
- A manual PDF upload is limited to 4 MB (Vercel request cap).

## Future improvements

Automatic match suggestions → one-click reconcile; daily balance and cash-flow dashboards;
bank-charge categorisation; more banks (ICICI, SBI, Axis, Federal, Kotak — one parser each);
journal / Tally / Zoho export; Gmail push notifications instead of polling.
