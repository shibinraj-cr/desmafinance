#!/usr/bin/env node
/*
 * DESMA — Import Odoo Sign export into Desgro STAGING (nothing goes live here)
 * ---------------------------------------------------------------------------
 * Put the files from odoo-sign-export.js into one folder:
 *     ./odoo-export/odoo-sign-metadata.json
 *     ./odoo-export/odoo-sign-batch-001.zip ... 00N.zip
 *
 * Setup:
 *     npm i @supabase/supabase-js adm-zip
 *     export SUPABASE_URL=https://xxxx.supabase.co
 *     export SUPABASE_SERVICE_ROLE_KEY=...        # server-only key, never commit
 *     # optional client matching against your Desgro clients/leads table:
 *     export CLIENTS_TABLE=clients CLIENT_EMAIL_COL=email CLIENT_PHONE_COL=phone CLIENT_NAME_COL=name
 *
 * Run:
 *     node import-odoo-sign.mjs ./odoo-export            # import all batches
 *     node import-odoo-sign.mjs ./odoo-export --dry      # read + verify only, no writes
 *
 * What it does (safe to re-run; it upserts by odoo_id and skips batches already imported):
 *   1. Re-checks SHA-256 of every PDF against the hash recorded at export time.
 *   2. Uploads PDFs to the private 'agreements' bucket under odoo/<odoo_id>/.
 *   3. Writes one row per Odoo request into esign_import_records with review_status='pending'.
 *   4. Suggests a Desgro client by email, then phone (last 10 digits), then exact name.
 * Records only become real agreements when someone approves them in the Desgro review screen.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { createClient } from '@supabase/supabase-js';

const dir = process.argv[2];
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
if (!dir || !fs.existsSync(dir)) { console.error('Usage: node import-odoo-sign.mjs <export-folder> [--dry] [--force]'); process.exit(1); }

const BUCKET = process.env.ESIGN_BUCKET || 'agreements';
const sb = DRY ? null : createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };

// ---------- client matching ----------
let clients = null;
async function loadClients() {
  const t = process.env.CLIENTS_TABLE;
  if (!t || DRY) return;
  const E = process.env.CLIENT_EMAIL_COL || 'email', P = process.env.CLIENT_PHONE_COL || 'phone', N = process.env.CLIENT_NAME_COL || 'name';
  clients = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await sb.from(t).select(`id, ${E}, ${P}, ${N}`).range(from, from + 999), 'load clients');
    clients.push(...rows.map((r) => ({ id: r.id, email: (r[E] || '').toLowerCase().trim(), phone: digits(r[P]), name: (r[N] || '').toLowerCase().trim() })));
    if (rows.length < 1000) break;
  }
  console.log(`Loaded ${clients.length} Desgro clients for matching`);
}
function match(signer) {
  if (!clients || !signer) return { match_status: 'unmatched', matched_client_id: null, match_candidates: [] };
  const email = (signer.email || signer.signer_email || '').toLowerCase().trim();
  const phone = digits(signer.mobile || signer.phone || signer.sms_number);
  const name = (signer.name || '').toLowerCase().trim();
  for (const [how, list] of [
    ['email', email ? clients.filter((c) => c.email === email) : []],
    ['phone', phone.length === 10 ? clients.filter((c) => c.phone === phone) : []],
    ['name', name ? clients.filter((c) => c.name === name) : []],
  ]) {
    if (list.length === 1) return { match_status: 'matched', matched_client_id: list[0].id, match_candidates: [{ id: list[0].id, by: how }] };
    if (list.length > 1) return { match_status: 'ambiguous', matched_client_id: null, match_candidates: list.slice(0, 10).map((c) => ({ id: c.id, by: how })) };
  }
  return { match_status: 'unmatched', matched_client_id: null, match_candidates: [] };
}

// ---------- main ----------
const zips = fs.readdirSync(dir).filter((f) => /^odoo-sign-batch-\d+\.zip$/.test(f)).sort();
const metaPath = path.join(dir, 'odoo-sign-metadata.json');
if (!fs.existsSync(metaPath)) console.warn('⚠ odoo-sign-metadata.json not found — templates will not be staged');
console.log(`${zips.length} batch file(s) found${DRY ? ' (DRY RUN)' : ''}`);
await loadClients();

if (!DRY && fs.existsSync(metaPath)) {
  // keep the raw template/field export in storage for the template-consolidation step
  must(await sb.storage.from(BUCKET).upload('odoo/_metadata/odoo-sign-metadata.json', fs.readFileSync(metaPath), { contentType: 'application/json', upsert: true }), 'upload metadata');
}

const totals = { records: 0, files: 0, hashMismatch: 0, missing: 0, matched: 0, ambiguous: 0, unmatched: 0 };
for (const zf of zips) {
  if (!DRY && !FORCE) {
    const { data } = await sb.from('esign_import_batches').select('id').eq('file_name', zf).maybeSingle();
    if (data) { console.log(`↷ ${zf} already imported (use --force to redo)`); continue; }
  }
  const zip = new AdmZip(path.join(dir, zf));
  const entries = Object.fromEntries(zip.getEntries().map((e) => [e.entryName, e]));
  const recordEntries = Object.keys(entries).filter((n) => n.endsWith('/record.json'));
  let batchFiles = 0, batchFailed = 0;
  const rows = [];

  for (const rn of recordEntries) {
    const rec = JSON.parse(entries[rn].getData().toString('utf8'));
    const files = [];
    for (const f of rec.files || []) {
      const e = f.path && entries[f.path];
      if (!e) { files.push({ ...f, verified: false, error: f.error || 'missing in zip' }); totals.missing++; batchFailed++; continue; }
      const buf = e.getData();
      const h = sha(buf);
      const ok = !f.sha256 || f.sha256 === h;
      if (!ok) { totals.hashMismatch++; batchFailed++; }
      const storage_path = `odoo/${rec.odoo_id}/${path.basename(f.path)}`;
      if (!DRY) must(await sb.storage.from(BUCKET).upload(storage_path, buf, { contentType: 'application/pdf', upsert: true }), `upload ${storage_path}`);
      files.push({ kind: f.kind, name: f.name, storage_path, sha256: h, size: buf.length, verified: ok });
      batchFiles++; totals.files++;
    }
    const client = rec.signers?.find((s) => (s.role || '').toLowerCase() !== 'employee' && (s.role || '').toLowerCase() !== 'user') || rec.signers?.[0];
    const m = match(client);
    totals[m.match_status]++;
    rows.push({
      odoo_id: rec.odoo_id,
      reference: rec.reference,
      odoo_state: rec.state,
      tags: rec.tags || [],
      signer_name: client?.name || null,
      signer_email: client?.email || client?.signer_email || null,
      signer_phone: client?.mobile || client?.phone || client?.sms_number || null,
      payload: rec,
      files,
      files_verified: files.length > 0 && files.every((f) => f.verified),
      ...m,
    });
    totals.records++;
  }

  if (!DRY) {
    const batch = must(await sb.from('esign_import_batches').upsert({ file_name: zf, record_count: rows.length, file_count: batchFiles, failed_files: batchFailed }, { onConflict: 'file_name' }).select('id').single(), 'batch row');
    for (let i = 0; i < rows.length; i += 50) {
      must(await sb.from('esign_import_records').upsert(rows.slice(i, i + 50).map((r) => ({ ...r, batch_id: batch.id })), { onConflict: 'odoo_id', ignoreDuplicates: false }), 'records upsert');
    }
  }
  console.log(`✔ ${zf}: ${rows.length} records, ${batchFiles} files${batchFailed ? `, ${batchFailed} problem file(s)` : ''}`);
}
console.log('\nTotals', totals);
console.log(DRY ? 'Dry run — nothing written.' : 'Staged. Review and approve in Desgro → Operations → Agreements → Odoo Import.');
