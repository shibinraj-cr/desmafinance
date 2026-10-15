# Desgro — Agreements (E-Sign) Module · Master Build Prompt

> Paste this whole file into Antigravity as one task. The database schema is in `desgro-esign-schema.sql`. Apply it first. The Odoo migration files are `odoo-sign-export.js` and `import-odoo-sign.mjs`.

---

## 0. Context

Desgro (desgro.in) is DESMA International's internal ERP and CRM. It is built with **Next.js (App Router) + Supabase (Postgres, Auth, Storage) + Vercel**. DESMA helps Indian nurses register and migrate to Australia and New Zealand (AHPRA, NCLEX, visa).

Client agreements are signed in **Odoo 18 Sign** today. Numbers from Odoo (Oct 2026):

- 900 sign requests since Nov 2024: 773 signed, 63 expired, 40 waiting, 24 cancelled.
- About 98% have **one signer (the client)**. A few have a second signer from DESMA.
- 9,884 audit events (create, open, sign, refuse, cancel).
- 887 templates. **Staff upload a newly edited PDF for every client.** This is the main problem to fix.
- Agreement types, from the tags: AHPRA Agreement, AHPRA Pathway, Visa Agreement (AUS), NZ Agreement, NCLEX RN Booking, Sales, Agent, Promotional Reels.
- Field types used: signature, initial, text, textarea, checkbox, radio, selection.

**Goal:** build an Agreements module at **`/operations/agreements`** that replaces Odoo Sign.

- Use **a few master templates** whose merge fields are filled from the Desgro client record. No more per-client PDF uploads.
- Each client signs on a mobile-first page after an OTP check.
- The final PDF has the fields and signatures burned in, plus an **audit certificate page** that can be verified.
- Migrate every Odoo record, and **have a person review and approve each one** before it goes live.

---

## 1. Rules that must not be broken

1. **WhatsApp:** only *send* approved template messages through the existing WABA Cloud API number. **Do not** change webhook subscriptions, app settings or the `/api/crm/wa/webhook` endpoint. Wabis receives live traffic on that WABA and must not be affected.
2. **Storage** is the private bucket `agreements`. Never make files public. Serve files only through links that expire within 10 minutes or less, created on the server after checking permissions.
3. **Signing link tokens** are 32 random bytes, encoded as base64url. Store only `sha256(token)` in the database.
4. **OTP:** a 6-digit code that expires after 10 minutes. Allow at most 5 attempts, then lock the signer for 30 minutes. Store only a hash. Send it by WhatsApp or email.
5. **`esign_events`** can only be added to; the database enforces this with hash-chained rows. Every state change writes an event.
6. Once a request is `signed`, it is **immutable**. No edits and no deletes. A correction means a new request that links back to the old one.
7. The Supabase service-role key is used only on the server: route handlers and server actions.
8. Times are stored in UTC and shown in **Asia/Kolkata**.
9. Migrated Odoo data goes into `esign_import_records` (staging). It never reaches `esign_requests` until a user approves it.

---

## 2. Data model

Use `desgro-esign-schema.sql` as it is. The key tables:

| Table | Purpose |
|---|---|
| `esign_templates` / `esign_template_versions` / `esign_template_fields` | Master templates, a PDF version for each change, and field boxes |
| `esign_requests` | One agreement sent to a client |
| `esign_signers` | One row per signer (Client, DESMA), with token, OTP, IP, user agent, location and status |
| `esign_field_values` | What each signer filled in |
| `esign_events` | Audit trail (hash chain) |
| `esign_import_batches` / `esign_import_records` | Odoo migration staging and review |

Field coordinates are **fractions of the page (0–1), measured from the top-left**, the same as Odoo's `posX/posY/width/height`, and pages are numbered from 1. `esign_requests.client_id` must point to the Desgro clients/leads table. Add the foreign key to match the real table.

---

## 3. Features

### 3.1 Templates: `/operations/agreements/templates`

- List the templates with category, current version, number of fields and usage count.
- **Create or edit a template:**
  1. Upload the PDF.
  2. Open the **field builder**: `pdf.js` shows the pages, with a field palette on the side.
  3. Drag fields onto the page. Resize and move them, and duplicate them across pages.
  4. Set each field's type, role (Client or DESMA), required flag, options, and an optional **merge key**.
- **Merge keys** are filled from the client record when the agreement is sent and are **locked** for the signer. Start with: `client.full_name`, `client.email`, `client.phone`, `client.address`, `client.passport_no`, `client.dob`, `client.registration_no`, `deal.service_name`, `deal.fee_amount`, `deal.fee_in_words`, `deal.gst_amount`, `deal.total_amount`, `deal.installments`, `today`, `staff.name`. Map each key to the real Desgro columns in one config file, `lib/esign/merge-keys.ts`.
- **Saving a changed PDF creates a new version.** Old requests keep their version.
- Each template also stores its default expiry and reminder days, email subject and body, and WhatsApp template name.
- **Clone a template.** Never hard-delete one; archive it instead.

### 3.2 Sending: from the client record, plus `/operations/agreements/new`

1. A **"Send Agreement"** button on the client and lead page.
2. Pick the template. The merge data is filled from the record and the staff member can edit it.
3. Live **PDF preview** with the merge values burned in. Use `pdf-lib`, with an embedded Unicode font such as Noto Sans so Indian names render correctly.
4. Set the signers: Client, defaulting to the client's details, plus an optional DESMA counter-signer. Set the order, CC list, expiry and reminder.
5. On **Send**:
   - Create the request with the merge data snapshot.
   - Save `original.pdf` and its SHA-256 hash.
   - Create the first signer's token.
   - Send the **email** (Resend from `agreements@desma.in`, or the email setup Desgro already has) and the **WhatsApp template message** with the link.
   - Write the `created` and `sent` events.
6. Options: save as a draft, resend, change the signer's email or phone (logged), cancel with a reason, and extend expiry.

### 3.3 Signer page: `/sign/[token]` (public, no login, mobile first)

1. Check the token: it must exist, not be expired, and the request must be in `sent` or `viewed` status.
   - If it's invalid or expired, show a friendly page with DESMA contact details.
2. Show DESMA branding and the agreement name.
3. **OTP step:** send a code to the signer's WhatsApp or email (masked), then verify it.
4. Show the PDF with `pdf.js`. Highlight this signer's fields and add a **"Next field"** button.
   - Merge fields are shown read-only.
5. **Signature:** let the signer draw (canvas, with smoothing), type (choice of handwriting-style fonts), or upload an image. Initials work the same way. Offer **"Adopt and apply to all"**.
6. Show a consent checkbox: *"I agree that my electronic signature is the legal equivalent of my handwritten signature."* Then **Sign and Finish**.
7. Also allow the signer to **decline** with a reason.
8. Record the IP (from `x-forwarded-for` on Vercel), the user agent, and location if the signer allows it.
9. Events to write: `opened`, `otp_sent`, `otp_verified` / `otp_failed`, `field_saved`, `signed` / `declined`.
10. When finished, show a success screen with a download link for the signed copy.

### 3.4 Finalizing (server job, runs after the last signer)

1. Load `original.pdf` and flatten all field values into it with `pdf-lib`: text, checkbox marks and signature images at their fractional positions.
2. **Add a certificate page** with:
   - DESMA logo, agreement reference, request ID, and the SHA-256 hash of the original document.
   - For each signer: name, email, phone (masked), role, OTP channel, IP, device or user agent, location, and when they viewed and signed (IST and UTC).
   - The full event timeline.
   - The final hash of the event chain and a verification URL: `/verify/[request_id]`.
3. Save `signed.pdf` and its SHA-256 hash. Set the status to `signed` and record `completed_at`.
4. Email the signed PDF to every signer and the CC list. Send a WhatsApp message saying it's done.
5. **Update the CRM:** set the client stage (for example "Agreement Signed") and add a timeline note. Fire a hook, `onAgreementSigned(request)`, so invoicing can plug in later.
6. **Verification page** `/verify/[id]`: anyone can upload a PDF, and the page reports whether its SHA-256 matches the stored signed hash. It shows only basic metadata, no personal data.

### 3.5 Background jobs (Vercel Cron, `/api/cron/esign`, every hour)

- **Reminders** go out every `reminder_days` until the request expires, using WhatsApp and email.
- **Expiry:** set the status to `expired` and write an event.
- **Morning summary to staff:** what was signed yesterday and what is still waiting after 3 days or more.

### 3.6 Dashboard: `/operations/agreements`

- Odoo-style views: **kanban and list**, with filters for status, tags and category, staff owner, date range, and source (Desgro or Odoo).
- Search by client name, email, phone or reference.
- Number cards: Sent, Waiting, Signed (this month), Expired, Average time to sign.
- Detail page: PDF viewer (signed or original), signers and their status, event timeline, and buttons for resend, remind, cancel, download, and copy the signing link (staff only).
- The client record gets an **Agreements tab** listing all of that client's agreements.
- **Roles:**
  - Admin: everything.
  - Ops staff: create, send and view.
  - BDE: view only their own clients.
- Use Supabase Auth plus RLS policies, or checks on the server.

### 3.7 Odoo migration review: `/operations/agreements/odoo-import` (admins only)

The data comes from `import-odoo-sign.mjs`, which fills `esign_import_records` (all with review status `pending`).

- **Summary bar:** total, pending, approved, rejected and needs-fix counts; matched, ambiguous and unmatched counts; and the number of problem files.
- **Review table:** reference, Odoo state, tags, signer name, email and phone, suggested client, file check status, and review status. Filters cover each of these.
- **Review drawer** for one record:
  - PDF preview of the signed document and certificate.
  - The Odoo signers and the event timeline.
  - The **client picker**: search Desgro clients, or "create a new client from the signer details".
  - Buttons: **Approve**, **Reject**, **Needs fix**, plus a note.
- **Bulk approve** applies only to the selected rows, and only when they are `matched` with all files verified. A confirmation dialog shows the count.
- **Approve → move to live**, all in one transaction:
  1. Create the `esign_requests` row with `source='odoo'`, `odoo_id`, the mapped status, `client_id`, tags, and dates.
  2. Create an `esign_signers` row from each Odoo signer, with `odoo_item_id`.
  3. Point `signed_path` and `certificate_path` (or `original_path`) at the storage files under `odoo/<id>/`.
  4. Turn each Odoo event into an `esign_events` row with action `imported:<odoo_action>` and `meta` containing the original IP, time and log hash.
  5. Add a final `imported` event recording who approved it.
  6. Set `promoted_request_id` on the staging record.
- **Odoo status mapping:**

  | Odoo | Desgro |
  |---|---|
  | `signed` | `signed` |
  | `sent` | `sent` (read-only, marked "Odoo – resend from Desgro") |
  | `expired` | `expired` |
  | `canceled` | `cancelled` |
  | `shared` | `draft` |
- **Rollback:** an approved import can be undone **only if** nothing new was attached to it. Undoing deletes the live rows and resets the staging record to pending.
- Export a CSV of every review decision.

---

## 4. Suggested file layout

```
app/(app)/operations/agreements/
  page.tsx                      # dashboard
  [id]/page.tsx                 # request detail
  new/page.tsx                  # send wizard
  templates/page.tsx
  templates/[id]/builder/page.tsx
  odoo-import/page.tsx
app/sign/[token]/page.tsx       # public signer page
app/verify/[id]/page.tsx
app/api/esign/
  requests/route.ts             # create/send
  requests/[id]/{resend,cancel,remind}/route.ts
  sign/[token]/{otp,verify,fields,complete,decline}/route.ts
  files/[id]/route.ts           # short-lived signed URLs after auth
  import/[id]/{approve,reject,rollback}/route.ts
app/api/cron/esign/route.ts
lib/esign/{pdf.ts,certificate.ts,tokens.ts,otp.ts,events.ts,notify.ts,merge-keys.ts,finalize.ts}
components/esign/{PdfViewer,FieldBuilder,SignaturePad,FieldPalette,StatusBadge,Timeline}.tsx
```

Libraries: `pdfjs-dist`, `pdf-lib`, `@pdf-lib/fontkit`, `signature_pad` (or a similar canvas library), `zod`, `resend`, plus the existing UI kit and Supabase client.

---

## 5. Build order (each phase must be demoable)

1. **Phase 1:** schema, storage bucket, template upload, field builder, and saving versions.
2. **Phase 2:** send wizard with merge data, PDF preview, email and WhatsApp sending.
3. **Phase 3:** signer page with OTP, fields and signature, then finalizing, the certificate page and the verify page.
4. **Phase 4:** dashboard, detail page, client Agreements tab, roles, cron for reminders and expiry.
5. **Phase 5:** Odoo import review screen, approve/reject, moving records live, rollback.
6. **Phase 6:** end-to-end tests (Playwright) for: send → open → OTP → sign → signed PDF hash matches the verify page; expiry; decline; a two-signer order; import approve and rollback.

## 6. Acceptance criteria

- [ ] A staff member can send an AHPRA agreement from a client record in under 1 minute, without uploading a PDF.
- [ ] A client can sign on a phone with a 4G connection in under 2 minutes.
- [ ] The signed PDF has every value in the right place on every page, plus a certificate page. Its SHA-256 matches `/verify`.
- [ ] Changing any `esign_events` row fails at the database level.
- [ ] Wrong OTP 5 times → locked. An expired link shows a friendly page.
- [ ] No file in the `agreements` bucket can be reached without a signed link.
- [ ] All 900 Odoo records are staged. None are live until approved. Counts by status and tag match the Odoo export summary.
- [ ] The WhatsApp webhook config on Meta is unchanged after deployment.
