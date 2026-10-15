/*
 * DESMA — Odoo Sign → Desgro export script
 * ------------------------------------------------------------
 * HOW TO RUN
 * 1. Log in to DESMA's Odoo instance as an admin.
 * 2. Open any Odoo page, press F12 → Console.
 * 3. Paste this whole file and press Enter.
 * 4. First run with DRY_RUN: true → it prints counts + estimated size, downloads nothing.
 * 5. Set DRY_RUN: false and run again. Chrome downloads:
 *      odoo-sign-metadata.json          (templates, fields, tags, roles, summary)
 *      odoo-sign-batch-001.zip ...      (BATCH_SIZE requests per zip, with PDFs)
 *    If Chrome asks "allow multiple downloads", click Allow.
 *    If it stops midway, set START_BATCH to the next batch number and re-run.
 *
 * Works on any Odoo Online plan (uses your logged-in session, not the external API).
 * Read-only: it never writes to Odoo.
 */
const CONFIG = {
  DRY_RUN: true,              // true = count only, no downloads
  BATCH_SIZE: 50,             // requests per zip (~200 MB each; full export ≈ 3.8 GB → ~18 zips)
  START_BATCH: 1,             // resume from this batch
  STATES: null,               // e.g. ['signed'] to export only fully signed; null = all
  INCLUDE_ORIGINALS: true,    // unsigned template PDF for sent/expired/cancelled requests
  INCLUDE_SIGNATURE_IMAGES: false, // raw signature/initial images (already inside the signed PDF)
};

await (async function odooSignExport(C) {
  const log = (...a) => console.log('%c[odoo-sign-export]', 'color:#7c3aed;font-weight:bold', ...a);

  // ---------- RPC helpers ----------
  const rpc = async (model, method, args, kwargs = {}) => {
    const r = await fetch('/web/dataset/call_kw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs } }),
    }).then((x) => x.json());
    if (r.error) throw new Error(`${model}.${method}: ${r.error.data?.message || r.error.message}`);
    return r.result;
  };
  const CTX = { active_test: false, lang: 'en_US' };
  const searchAll = async (model, domain, fields, page = 500) => {
    const out = [];
    for (let offset = 0; ; offset += page) {
      const rows = await rpc(model, 'search_read', [domain], { fields, offset, limit: page, order: 'id asc', context: CTX });
      out.push(...rows);
      if (rows.length < page) return out;
    }
  };
  const readIds = async (model, ids, fields, chunk = 500) => {
    const uniq = [...new Set(ids.filter(Boolean))];
    const out = [];
    for (let i = 0; i < uniq.length; i += chunk) out.push(...(await rpc(model, 'read', [uniq.slice(i, i + chunk)], { fields, context: CTX })));
    return out;
  };
  const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
  const m2o = (v) => (Array.isArray(v) ? { id: v[0], name: v[1] } : null);
  const m2oId = (v) => (Array.isArray(v) ? v[0] : null);
  const chunked = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\n\r]+/g, '_').slice(0, 120);
  const sha256 = async (buf) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');

  // ---------- 1. Read everything ----------
  log('Reading sign requests…');
  const reqDomain = C.STATES ? [['state', 'in', C.STATES]] : [];
  const requests = await searchAll('sign.request', reqDomain, [
    'reference', 'subject', 'state', 'template_id', 'template_tags', 'request_item_ids', 'cc_partner_ids',
    'completed_document_attachment_ids', 'attachment_ids', 'create_date', 'create_uid', 'completion_date',
    'validity', 'last_action_date', 'reminder_enabled', 'reminder', 'nb_total', 'nb_closed', 'active', 'integrity',
  ]);
  const reqIds = requests.map((r) => r.id);
  log(`${requests.length} requests`);

  const items = await readIds('sign.request.item', requests.flatMap((r) => r.request_item_ids), [
    'sign_request_id', 'partner_id', 'role_id', 'state', 'signer_email', 'signing_date', 'mail_sent_order',
    'sms_number', 'latitude', 'longitude', 'signed_without_extra_auth', 'is_mail_sent', 'access_via_link',
  ]);
  const partnerIds = [...items.map((i) => m2oId(i.partner_id)), ...requests.flatMap((r) => r.cc_partner_ids)];
  let partnerFields = ['name', 'email', 'phone', 'mobile'];
  let partners;
  try { partners = byId(await readIds('res.partner', partnerIds, partnerFields)); }
  catch { partnerFields = ['name', 'email', 'phone']; partners = byId(await readIds('res.partner', partnerIds, partnerFields)); }

  log('Reading field values and audit logs…');
  const values = [];
  const logs = [];
  let valuesAccessible = true; // Odoo 18 blocks RPC access to sign.request.item.value; values are burned into the signed PDF anyway
  for (const ids of chunked(reqIds, 200)) {
    if (valuesAccessible) {
      try { values.push(...(await searchAll('sign.request.item.value', [['sign_request_id', 'in', ids]], ['sign_request_item_id', 'sign_item_id', 'sign_request_id', 'value']))); }
      catch (e) { valuesAccessible = false; log('Field values not readable via RPC (expected on Odoo 18) — skipping; they are inside the signed PDFs.'); }
    }
    logs.push(...(await searchAll('sign.log', [['sign_request_id', 'in', ids]], ['sign_request_id', 'sign_request_item_id', 'log_date', 'action', 'request_state', 'ip', 'latitude', 'longitude', 'partner_id', 'user_id', 'log_hash'])));
  }

  log('Reading templates, fields, tags, roles…');
  const templateIds = [...new Set(requests.map((r) => m2oId(r.template_id)).filter(Boolean))];
  const templates = await readIds('sign.template', templateIds, ['name', 'attachment_id', 'num_pages', 'tag_ids', 'sign_item_ids', 'active', 'user_id', 'redirect_url', 'signed_count', 'in_progress_count']);
  const signItems = byId(await readIds('sign.item', templates.flatMap((t) => t.sign_item_ids), ['template_id', 'type_id', 'responsible_id', 'required', 'name', 'page', 'posX', 'posY', 'width', 'height', 'alignment', 'option_ids']));
  const itemTypes = byId(await searchAll('sign.item.type', [], ['name', 'item_type']));
  const options = byId(await readIds('sign.item.option', Object.values(signItems).flatMap((s) => s.option_ids), ['value']));
  const tags = byId(await searchAll('sign.template.tag', [], ['name', 'color']));
  const roles = byId(await searchAll('sign.item.role', [], ['name']));
  const users = byId(await readIds('res.users', requests.map((r) => m2oId(r.create_uid)), ['name', 'login']));

  // attachments metadata (no content yet)
  const tplAttIds = templates.map((t) => m2oId(t.attachment_id));
  const doneAttIds = requests.flatMap((r) => r.completed_document_attachment_ids);
  const extraAttIds = requests.flatMap((r) => r.attachment_ids);
  const atts = byId(await readIds('ir.attachment', [...tplAttIds, ...doneAttIds, ...extraAttIds], ['name', 'mimetype', 'file_size', 'checksum']));
  const tplById = byId(templates);

  // ---------- 2. Normalise ----------
  const fieldTypeOf = (signItemId) => itemTypes[m2oId(signItems[signItemId]?.type_id)]?.item_type || 'unknown';
  const valuesByItem = {};
  for (const v of values) (valuesByItem[m2oId(v.sign_request_item_id)] ||= []).push(v);
  const logsByReq = {};
  for (const l of logs) (logsByReq[m2oId(l.sign_request_id)] ||= []).push(l);
  const itemsByReq = {};
  for (const i of items) (itemsByReq[m2oId(i.sign_request_id)] ||= []).push(i);

  const partnerOut = (pid) => {
    const p = partners[pid];
    return p ? { odoo_partner_id: pid, name: p.name, email: p.email || null, phone: p.phone || null, mobile: p.mobile || null } : null;
  };

  const records = requests.map((r) => {
    const tpl = tplById[m2oId(r.template_id)];
    const reqLogs = (logsByReq[r.id] || []).sort((a, b) => a.log_date.localeCompare(b.log_date));
    const signers = (itemsByReq[r.id] || []).sort((a, b) => a.mail_sent_order - b.mail_sent_order).map((it) => {
      const signLog = reqLogs.find((l) => m2oId(l.sign_request_item_id) === it.id && l.action === 'sign');
      return {
        odoo_item_id: it.id,
        role: m2o(it.role_id)?.name || null,
        ...(partnerOut(m2oId(it.partner_id)) || {}),
        signer_email: it.signer_email || null,
        sms_number: it.sms_number || null,
        state: it.state,
        sign_order: it.mail_sent_order,
        signed_at: it.signing_date || signLog?.log_date || null,
        ip: signLog?.ip || null,
        latitude: it.latitude || null,
        longitude: it.longitude || null,
        signed_without_extra_auth: it.signed_without_extra_auth,
        values: (valuesByItem[it.id] || []).map((v) => {
          const si = signItems[m2oId(v.sign_item_id)];
          const type = fieldTypeOf(m2oId(v.sign_item_id));
          const isImage = type === 'signature' || type === 'initial';
          return {
            field: si?.name || itemTypes[m2oId(si?.type_id)]?.name || null,
            type, page: si?.page ?? null,
            x: si?.posX ?? null, y: si?.posY ?? null, w: si?.width ?? null, h: si?.height ?? null,
            value: isImage && !C.INCLUDE_SIGNATURE_IMAGES ? '[image in signed PDF]' : v.value,
          };
        }),
      };
    });
    // files to fetch
    const files = [];
    const kindOf = (a) => (/certificate/i.test(a.name) ? 'certificate' : 'signed');
    for (const id of r.completed_document_attachment_ids) atts[id] && files.push({ att_id: id, kind: kindOf(atts[id]), name: atts[id].name, size: atts[id].file_size, odoo_checksum: atts[id].checksum });
    for (const id of r.attachment_ids) atts[id] && files.push({ att_id: id, kind: 'extra', name: atts[id].name, size: atts[id].file_size, odoo_checksum: atts[id].checksum });
    const tplAtt = atts[m2oId(tpl?.attachment_id)];
    if (C.INCLUDE_ORIGINALS && r.state !== 'signed' && tplAtt) files.push({ att_id: tplAtt.id, kind: 'original', name: tplAtt.name, size: tplAtt.file_size, odoo_checksum: tplAtt.checksum });

    return {
      odoo_id: r.id,
      reference: r.reference,
      subject: r.subject,
      state: r.state, // sent | signed | canceled | expired | shared
      archived: !r.active,
      tags: r.template_tags.map((t) => tags[t]?.name).filter(Boolean),
      template: tpl ? { odoo_template_id: tpl.id, name: tpl.name } : null,
      created_at: r.create_date,
      created_by: users[m2oId(r.create_uid)] ? { name: users[m2oId(r.create_uid)].name, login: users[m2oId(r.create_uid)].login } : null,
      completion_date: r.completion_date || null,
      validity: r.validity || null,
      last_action_date: r.last_action_date || null,
      reminder_days: r.reminder_enabled ? r.reminder : null,
      odoo_integrity_ok: r.integrity,
      cc: r.cc_partner_ids.map(partnerOut).filter(Boolean),
      signers,
      events: reqLogs.map((l) => ({
        at: l.log_date, action: l.action, request_state: l.request_state, ip: l.ip || null,
        latitude: l.latitude || null, longitude: l.longitude || null,
        odoo_item_id: m2oId(l.sign_request_item_id), partner: m2o(l.partner_id)?.name || null,
        user: m2o(l.user_id)?.name || null, odoo_log_hash: l.log_hash || null,
      })),
      files,
    };
  });

  const metadata = {
    exported_at: new Date().toISOString(),
    source: location.origin,
    config: C,
    summary: {
      requests: records.length,
      by_state: records.reduce((a, r) => ((a[r.state] = (a[r.state] || 0) + 1), a), {}),
      by_tag: records.flatMap((r) => r.tags).reduce((a, t) => ((a[t] = (a[t] || 0) + 1), a), {}),
      signers: items.length,
      events: logs.length,
      files: records.reduce((a, r) => a + r.files.length, 0),
      total_mb: Math.round(records.reduce((a, r) => a + r.files.reduce((s, f) => s + (f.size || 0), 0), 0) / 1048576),
      batches: Math.ceil(records.length / C.BATCH_SIZE),
    },
    tags: Object.values(tags).map((t) => ({ odoo_id: t.id, name: t.name })),
    roles: Object.values(roles).map((r) => ({ odoo_id: r.id, name: r.name })),
    templates: templates.map((t) => ({
      odoo_template_id: t.id, name: t.name, active: t.active, num_pages: t.num_pages,
      tags: t.tag_ids.map((x) => tags[x]?.name).filter(Boolean),
      signed_count: t.signed_count, in_progress_count: t.in_progress_count,
      fields: t.sign_item_ids.map((id) => signItems[id]).filter(Boolean).map((s) => ({
        name: s.name, type: itemTypes[m2oId(s.type_id)]?.item_type, role: m2o(s.responsible_id)?.name || null,
        required: s.required, page: s.page, x: s.posX, y: s.posY, w: s.width, h: s.height, alignment: s.alignment,
        options: s.option_ids.map((o) => options[o]?.value).filter(Boolean),
      })),
    })),
  };

  log('Summary', metadata.summary);
  console.table(metadata.summary.by_state);
  if (C.DRY_RUN) {
    log('DRY RUN complete — nothing downloaded. Set DRY_RUN: false to export.');
    window.__odooSignExport = { metadata, records };
    return;
  }

  // ---------- 3. Download ----------
  if (typeof JSZip === 'undefined') {
    await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.onload = ok; s.onerror = () => no(new Error('Could not load JSZip')); document.head.appendChild(s); });
  }
  const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); };
  const fetchFile = async (id, tries = 3) => {
    for (let t = 1; ; t++) {
      try { const r = await fetch(`/web/content/${id}?download=true`); if (!r.ok) throw new Error(r.status); return await r.arrayBuffer(); }
      catch (e) { if (t >= tries) throw e; await new Promise((s) => setTimeout(s, 1500 * t)); }
    }
  };

  if (C.START_BATCH === 1) save(new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }), 'odoo-sign-metadata.json');

  const batches = chunked(records, C.BATCH_SIZE);
  const failures = [];
  for (let b = C.START_BATCH - 1; b < batches.length; b++) {
    const zip = new JSZip();
    const batchNo = String(b + 1).padStart(3, '0');
    for (const rec of batches[b]) {
      const dir = `requests/${rec.odoo_id}`;
      for (const f of rec.files) {
        try {
          const buf = await fetchFile(f.att_id);
          f.path = `${dir}/${f.kind}__${safe(f.name)}`;
          f.sha256 = await sha256(buf);
          f.size = buf.byteLength;
          zip.file(f.path, buf);
        } catch (e) { f.error = String(e); failures.push({ odoo_id: rec.odoo_id, att_id: f.att_id, error: String(e) }); }
      }
      zip.file(`${dir}/record.json`, JSON.stringify(rec, null, 2));
    }
    zip.file('batch.json', JSON.stringify({ batch: b + 1, of: batches.length, exported_at: new Date().toISOString(), odoo_ids: batches[b].map((r) => r.odoo_id) }, null, 2));
    log(`Zipping batch ${b + 1}/${batches.length}…`);
    save(await zip.generateAsync({ type: 'blob', compression: 'STORE' }), `odoo-sign-batch-${batchNo}.zip`);
    log(`✔ batch ${batchNo} saved`);
  }
  if (failures.length) { console.warn('Some files failed:', failures); save(new Blob([JSON.stringify(failures, null, 2)]), 'odoo-sign-failures.json'); }
  log('DONE.', failures.length ? `${failures.length} file(s) failed — see odoo-sign-failures.json` : 'All files exported.');
})(CONFIG);
