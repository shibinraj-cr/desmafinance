// Single source of truth for the Google Apps Script that syncs a lead
// spreadsheet to the CRM. Served on the CRM Integrations page (copy button) so
// non-developers can set it up without touching the repo. Keep it dependency-free
// plain ES5 — it runs in Google Apps Script, not Node.
export const SHEET_LEADS_APPS_SCRIPT = `/**
 * Desma CRM — lead spreadsheet sync (Meta lead-ads, Website/SEO form, …).
 *
 * Pushes new rows from every tab to the CRM webhook. Each tab is sent as a
 * "campaign"; CRM_SOURCE (set once below) picks the CRM column mapping. A
 * per-tab cursor tracks the last-synced row so only NEW leads go out. Re-runs
 * are safe — the CRM dedupes by a stable per-row key, so nothing double-inserts.
 *
 * SETUP (once per spreadsheet):
 * 1. Extensions -> Apps Script. Paste this whole file. Save.
 * 2. Project Settings (gear) -> Script properties -> add:
 *      CRM_WEBHOOK_URL     = (shown on the CRM Integrations page)
 *      CRM_WEBHOOK_SECRET  = (shown on the CRM Integrations page)
 *      CRM_SOURCE          = meta   OR   website
 * 3. Run initBaseline once -> only leads added after now will sync.
 *    (Run resetForBackfill instead to import the whole sheet.)
 * 4. Triggers (clock) -> Add Trigger -> function syncNewLeads,
 *    Time-driven -> Minutes timer -> Every minute.
 */

var HEADER_ROW = 1;
var SERVER_BATCH = 200;

function _docProps() { return PropertiesService.getDocumentProperties(); }
function _cursorKey(sheetName) { return 'cursor::' + sheetName; }

function _config() {
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('CRM_WEBHOOK_URL');
  var secret = p.getProperty('CRM_WEBHOOK_SECRET');
  var source = p.getProperty('CRM_SOURCE');
  if (!url || !secret || !source) {
    throw new Error('Set CRM_WEBHOOK_URL, CRM_WEBHOOK_SECRET and CRM_SOURCE in Project Settings -> Script properties.');
  }
  return { url: url, secret: secret, source: source };
}

function initBaseline() {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  sheets.forEach(function (sh) {
    _docProps().setProperty(_cursorKey(sh.getName()), String(sh.getLastRow()));
  });
  Logger.log('Baseline set for ' + sheets.length + ' tab(s). Only new leads will sync.');
}

function resetForBackfill() {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  sheets.forEach(function (sh) {
    _docProps().setProperty(_cursorKey(sh.getName()), String(HEADER_ROW));
  });
  Logger.log('Cursors reset — next syncNewLeads run will backfill all rows.');
}

function syncNewLeads() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) return;
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
  if (lastRow <= cursor) return;

  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim();
  });

  var startRow = cursor + 1;
  var values = sh.getRange(startRow, 1, lastRow - cursor, lastCol).getValues();

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
    _docProps().setProperty(_cursorKey(name), String(lastRow));
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

  _docProps().setProperty(_cursorKey(name), String(allOk ? lastRow : lastSentRow));
}

function _post(cfg, campaign, rows) {
  var res = UrlFetchApp.fetch(cfg.url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-webhook-secret': cfg.secret },
    payload: JSON.stringify({ source: cfg.source, campaign: campaign, rows: rows }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code >= 200 && code < 300) return true;
  Logger.log('CRM webhook returned ' + code + ': ' + res.getContentText());
  return false;
}
`;
