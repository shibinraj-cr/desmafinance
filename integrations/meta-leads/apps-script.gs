/**
 * Desma CRM — Meta lead-ads sheet sync.
 *
 * Pushes new rows from every campaign tab to the CRM webhook. Each tab = one
 * campaign; the tab name is sent as the campaign. A per-tab cursor tracks the
 * last-synced row so only NEW leads are sent. Re-runs are safe — the CRM also
 * dedupes by a stable per-row key (externalKey), so nothing is double-inserted.
 *
 * ── SETUP (once) ────────────────────────────────────────────────────────────
 * 1. In the spreadsheet: Extensions → Apps Script. Paste this whole file. Save.
 * 2. Project Settings (gear) → Script properties → add two properties:
 *      CRM_WEBHOOK_URL     = https://www.desgro.in/api/integrations/meta-leads
 *      CRM_WEBHOOK_SECRET  = <same value as META_LEADS_WEBHOOK_SECRET in Vercel>
 * 3. Run the `initBaseline` function once (Run menu). This points every tab's
 *    cursor at its current last row, so only leads added AFTER now will sync.
 *    (Skip this step if you want to backfill the whole sheet instead.)
 * 4. Triggers (clock icon) → Add Trigger:
 *      function: syncNewLeads   event: Time-driven → Minutes timer → Every minute
 * Done. New Meta leads now flow into the CRM within ~1 minute.
 */

var HEADER_ROW = 1;
var SERVER_BATCH = 200; // rows per webhook request (server cap is 500)

function _docProps() { return PropertiesService.getDocumentProperties(); }
function _cursorKey(sheetName) { return 'cursor::' + sheetName; }

function _config() {
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('CRM_WEBHOOK_URL');
  var secret = p.getProperty('CRM_WEBHOOK_SECRET');
  if (!url || !secret) {
    throw new Error('Set CRM_WEBHOOK_URL and CRM_WEBHOOK_SECRET in Project Settings → Script properties.');
  }
  return { url: url, secret: secret };
}

/** Point every tab's cursor at its current last row — only new rows sync after. */
function initBaseline() {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  sheets.forEach(function (sh) {
    _docProps().setProperty(_cursorKey(sh.getName()), String(sh.getLastRow()));
  });
  Logger.log('Baseline set for ' + sheets.length + ' tab(s). Only new leads will sync.');
}

/** Reset baseline so the next run re-sends every data row (for a full backfill). */
function resetForBackfill() {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  sheets.forEach(function (sh) {
    _docProps().setProperty(_cursorKey(sh.getName()), String(HEADER_ROW));
  });
  Logger.log('Cursors reset — next syncNewLeads run will backfill all rows.');
}

/** Trigger entry point — sync new rows from every tab. */
function syncNewLeads() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) return; // another run is in progress
  try {
    var cfg = _config();
    SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sh) {
      _syncSheet(sh, cfg);
    });
  } finally {
    lock.releaseLock();
  }
}

function _syncSheet(sh, cfg) {
  var name = sh.getName();
  var lastRow = sh.getLastRow();
  if (lastRow <= HEADER_ROW) return;

  var cursor = parseInt(_docProps().getProperty(_cursorKey(name)) || String(HEADER_ROW), 10);
  if (isNaN(cursor) || cursor < HEADER_ROW) cursor = HEADER_ROW;
  if (lastRow <= cursor) return; // nothing new

  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim();
  });

  var startRow = cursor + 1;
  // getValues (NOT getDisplayValues) so phone numbers keep their full digits.
  var values = sh.getRange(startRow, 1, lastRow - cursor, lastCol).getValues();

  // Build {rowNum, obj} for non-blank rows.
  var dataRows = [];
  for (var i = 0; i < values.length; i++) {
    var obj = {};
    var hasData = false;
    for (var c = 0; c < headers.length; c++) {
      var key = headers[c];
      if (!key) continue;
      var v = values[i][c];
      if (v instanceof Date) v = v.toISOString();
      if (v !== '' && v !== null && v !== undefined) hasData = true;
      obj[key] = v;
    }
    if (hasData) dataRows.push({ rowNum: startRow + i, obj: obj });
  }

  if (dataRows.length === 0) {
    _docProps().setProperty(_cursorKey(name), String(lastRow)); // skip trailing blanks
    return;
  }

  var lastSentRow = cursor;
  var allOk = true;
  for (var b = 0; b < dataRows.length; b += SERVER_BATCH) {
    var chunk = dataRows.slice(b, b + SERVER_BATCH);
    var ok = _post(cfg, name, chunk.map(function (r) { return r.obj; }));
    if (!ok) { allOk = false; break; }
    lastSentRow = chunk[chunk.length - 1].rowNum;
  }

  // Advance cursor to the last successfully-sent row (or the whole sheet if all
  // chunks succeeded). A failed chunk is retried on the next run.
  _docProps().setProperty(_cursorKey(name), String(allOk ? lastRow : lastSentRow));
}

function _post(cfg, campaign, rows) {
  var res = UrlFetchApp.fetch(cfg.url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-webhook-secret': cfg.secret },
    payload: JSON.stringify({ campaign: campaign, rows: rows }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code >= 200 && code < 300) return true;
  Logger.log('CRM webhook returned ' + code + ': ' + res.getContentText());
  return false;
}
