import { getSetting } from "@/lib/app-settings";
import {
  normaliseStatus,
  isSaturdayRuleExempt,
  SATURDAY_START_MIN,
  SATURDAY_END_MIN,
  type ParsedDay,
} from "@/lib/hr-attendance-parser";

/**
 * eTimeOffice / Team Office (Star Link) biometric cloud API adapter.
 *
 * The real API is a GET-based REST service at https://api.etimeoffice.com/api/
 * secured with HTTP Basic auth built from your Corporate ID + Username +
 * Password. (It is NOT the POST-login → Bearer-token flow some blog posts
 * describe — that is inaccurate.) The punch endpoint returns one JSON record
 * per employee per day with IN/OUT times, which we normalise into the SAME
 * `ParsedDay` shape the .xls parser produces, so the downstream ingestion
 * pipeline (`ingestParsedAttendance`) treats API data identically to an upload.
 *
 * ── Auth is the one vendor-specific unknown ──────────────────────────────────
 * The exact composition of the Basic credential differs across portal versions.
 * Rather than hard-code one guess, `buildAuthHeader` is config-driven:
 *
 *   ETIMEOFFICE_AUTH_HEADER  → used verbatim as the Authorization header (best:
 *                              paste exactly what your API PDF / Postman shows).
 *   ETIMEOFFICE_AUTH_RAW     → base64-encoded as the Basic credential.
 *   ETIMEOFFICE_AUTH_MODE    → "corp-user-pass" (default): Basic base64(
 *                              CorporateId:Username:Password:True) — the doc'd,
 *                              verified format (the trailing True is required);
 *                              or "user-pass": Basic base64(username:password).
 *
 * The default matches the official eTimeOffice API doc and is verified working.
 */

export type EtimeConfig = {
  baseUrl: string; // always ends with "/"
  corpId: string;
  username: string;
  password: string;
  empcode: string; // "ALL" or a specific code
  authMode: string;
  authRaw: string | null;
  authHeader: string | null;
};

/** AppSetting keys — the settings screen writes these; getEtimeConfig reads them. */
export const ETIME_CFG_KEYS = {
  baseUrl: "etimeoffice_base_url",
  corpId: "etimeoffice_corp_id",
  username: "etimeoffice_username",
  password: "etimeoffice_password",
  empcode: "etimeoffice_empcode",
  authMode: "etimeoffice_auth_mode",
} as const;

const CFG_KEYS = ETIME_CFG_KEYS;

const DEFAULT_BASE_URL = "https://api.etimeoffice.com/api/";

/** Read config from AppSetting first (in-app configurable), env as fallback. */
export async function getEtimeConfig(): Promise<EtimeConfig | null> {
  const [baseUrl, corpId, username, password, empcode, authMode] = await Promise.all([
    getSetting(CFG_KEYS.baseUrl).catch(() => null),
    getSetting(CFG_KEYS.corpId).catch(() => null),
    getSetting(CFG_KEYS.username).catch(() => null),
    getSetting(CFG_KEYS.password).catch(() => null),
    getSetting(CFG_KEYS.empcode).catch(() => null),
    getSetting(CFG_KEYS.authMode).catch(() => null),
  ]);

  const resolvedCorp = corpId || process.env.ETIMEOFFICE_CORP_ID || "";
  const resolvedUser = username || process.env.ETIMEOFFICE_USERNAME || "";
  const resolvedPass = password || process.env.ETIMEOFFICE_PASSWORD || "";
  const authRaw = process.env.ETIMEOFFICE_AUTH_RAW || null;
  const authHeader = process.env.ETIMEOFFICE_AUTH_HEADER || null;

  // Configured if we have either a fully-formed header/raw credential, or the
  // corp/user/pass triple.
  const hasCreds = !!authHeader || !!authRaw || (!!resolvedCorp && !!resolvedUser && !!resolvedPass);
  if (!hasCreds) return null;

  let base = baseUrl || process.env.ETIMEOFFICE_BASE_URL || DEFAULT_BASE_URL;
  if (!base.endsWith("/")) base += "/";

  return {
    baseUrl: base,
    corpId: resolvedCorp,
    username: resolvedUser,
    password: resolvedPass,
    empcode: empcode || process.env.ETIMEOFFICE_EMPCODE || "ALL",
    authMode: authMode || process.env.ETIMEOFFICE_AUTH_MODE || "corp-user-pass",
    authRaw,
    authHeader,
  };
}

/** Non-secret view of the config for status/diagnostics (no password). */
export function describeConfig(cfg: EtimeConfig): {
  baseUrl: string;
  empcode: string;
  authMode: string;
  usernameMasked: string;
} {
  const u = cfg.username;
  return {
    baseUrl: cfg.baseUrl,
    empcode: cfg.empcode,
    authMode: cfg.authHeader ? "raw-header" : cfg.authRaw ? "raw-base64" : cfg.authMode,
    usernameMasked: u ? `${u.slice(0, 2)}***` : "(env-supplied)",
  };
}

export function buildAuthHeader(cfg: EtimeConfig): string {
  if (cfg.authHeader) return cfg.authHeader;
  if (cfg.authRaw) return `Basic ${Buffer.from(cfg.authRaw, "utf8").toString("base64")}`;
  // Per the eTimeOffice API doc, the Basic credential is a FOUR-part string:
  //   CorporateId:Username:Password:True
  // The trailing `True` flag is REQUIRED. Omitting it makes their controller
  // crash with a 500 IndexOutOfRangeException *after* auth passes (it validates
  // parts [0..2] then reads part [3]). Verified live against the account. The
  // "user-pass" mode is a 2-part fallback for portal variants that omit corp id.
  const cred =
    cfg.authMode === "user-pass"
      ? `${cfg.username}:${cfg.password}`
      : `${cfg.corpId}:${cfg.username}:${cfg.password}:True`;
  return `Basic ${Buffer.from(cred, "utf8").toString("base64")}`;
}

/** Format a Date as dd/MM/yyyy (the eTimeOffice query format), in UTC. */
export function toEtimeDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = d.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}

// ── Time / date parsing (tolerant of the API's field variants) ───────────────

function toMinutes(hhmm: unknown): number {
  const s = String(hhmm ?? "").trim();
  if (!s || s === "--:--" || s === "0" || s === "0:00" || s === "00:00") return 0;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return +m[1] * 60 + +m[2];
}

function cleanTime(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s || s === "--:--" || s === "--") return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/** Parse dd/MM/yyyy, dd-MM-yyyy, or an ISO date into a UTC date-only Date. */
export function parseEtimeDate(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Case-insensitive field getter — the API's key casing varies by version. */
function field(rec: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) {
    if (rec[n] != null) return rec[n];
    const lower = n.toLowerCase();
    for (const k of Object.keys(rec)) {
      if (k.toLowerCase() === lower && rec[k] != null) return rec[k];
    }
  }
  return undefined;
}

/**
 * Map one raw eTimeOffice punch record to a `ParsedDay`, applying the exact
 * same status normalisation and Saturday late/early-out recompute the .xls
 * parser does — so an API-sourced day is indistinguishable from an uploaded one
 * once it reaches `ingestParsedAttendance`. Returns null for records missing a
 * usable date.
 */
export function mapPunchRecord(rec: Record<string, unknown>, now: Date = new Date()): ParsedDay | null {
  const date = parseEtimeDate(field(rec, "DateString", "Date", "PunchDate", "AttDate"));
  if (!date) return null;

  // A day is "complete" only once it's strictly in the past. Today (and any
  // future date) is still in progress, so a lone IN punch with no OUT yet must
  // stay Present rather than be docked as a half-day.
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayComplete = date.getTime() < todayUtc;

  const empCode = String(field(rec, "Empcode", "EmpCode", "EmployeeCode", "PayCode") ?? "").trim();
  const rawName = String(field(rec, "Name", "EmployeeName", "EmpName") ?? "").trim();

  const shiftRaw = String(field(rec, "Shift", "ShiftCode") ?? "").trim();
  const shiftCode = shiftRaw && shiftRaw !== "--" ? shiftRaw : null;

  const inTime = cleanTime(field(rec, "INTime", "InTime", "In", "PunchIn"));
  const outTime = cleanTime(field(rec, "OUTTime", "OutTime", "Out", "PunchOut"));

  let lateMinutes = toMinutes(field(rec, "Late_In", "LateIn", "LateArrival", "Late"));
  let earlyOutMinutes = toMinutes(field(rec, "Erl_Out", "EarlyOut", "EarlyDeparture", "EarlyGoing"));

  // Worked minutes (excl. OT). The half-day rule is punch-based, so this is
  // informational; map defensively from whatever "work" field exists.
  const workTime = toMinutes(field(rec, "WorkTime", "WorkingHours", "Hours", "Duration"));
  const otMinutes = toMinutes(field(rec, "OverTime", "OT", "OtHours"));
  const workMinutes = Math.max(0, workTime - Math.min(workTime, otMinutes));

  const statusRaw = String(field(rec, "Status", "AttStatus", "StatusCode") ?? "").trim();
  const remarkRaw = String(field(rec, "Remark", "Remarks") ?? "").trim();
  const remark = !remarkRaw || remarkRaw === "--" ? null : remarkRaw;

  const status = normaliseStatus(statusRaw, date, inTime, outTime, dayComplete);

  // Saturday: recompute late / early-out against the company 09:00 → 16:00
  // window (the biometric computes them against the weekday shift). Mirrors the
  // .xls parser exactly; exempt employees keep the reported values.
  if (date.getUTCDay() === 6 && !isSaturdayRuleExempt(rawName)) {
    lateMinutes = inTime ? Math.max(0, toMinutes(inTime) - SATURDAY_START_MIN) : 0;
    earlyOutMinutes = outTime ? Math.max(0, SATURDAY_END_MIN - toMinutes(outTime)) : 0;
  }

  return {
    empCode,
    rawName,
    date,
    shiftCode,
    inTime,
    outTime,
    workMinutes,
    otMinutes,
    lateMinutes,
    earlyOutMinutes,
    status,
    remark,
  };
}

/** Pull the array of punch records out of the API response, whatever it wraps. */
export function extractRecords(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["InOutPunchData", "PunchData", "Data", "data", "Result", "AttendanceData"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
  }
  return [];
}

export type EtimeFetchResult = {
  rows: ParsedDay[];
  warnings: string[];
  fetched: number;
  rangeStart: string;
  rangeEnd: string;
};

/**
 * Fetch in/out punch data for [fromDate, toDate] (inclusive) and map it to
 * `ParsedDay[]`. Throws on config/HTTP/parse failure (the caller surfaces it).
 */
export async function fetchInOutPunchData(args: {
  fromDate: Date;
  toDate: Date;
  cfg?: EtimeConfig;
}): Promise<EtimeFetchResult> {
  const cfg = args.cfg ?? (await getEtimeConfig());
  if (!cfg) {
    throw new Error(
      "eTimeOffice is not configured. Set ETIMEOFFICE_CORP_ID / ETIMEOFFICE_USERNAME / ETIMEOFFICE_PASSWORD (or an AppSetting equivalent).",
    );
  }

  const from = toEtimeDate(args.fromDate);
  const to = toEtimeDate(args.toDate);
  const url = `${cfg.baseUrl}DownloadInOutPunchData?Empcode=${encodeURIComponent(cfg.empcode)}&FromDate=${encodeURIComponent(from)}&ToDate=${encodeURIComponent(to)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: buildAuthHeader(cfg), Accept: "application/json" },
    // Never cache a payroll data pull.
    cache: "no-store",
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`eTimeOffice API ${res.status} ${res.statusText}: ${bodyText.slice(0, 300)}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`eTimeOffice API returned non-JSON: ${bodyText.slice(0, 300)}`);
  }

  // Some responses signal an application-level error inside a 200.
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    const err = obj.Error ?? obj.error;
    if (err === true || (typeof err === "string" && err && err !== "false")) {
      const msg = String(obj.Msg ?? obj.msg ?? obj.Message ?? err);
      throw new Error(`eTimeOffice API error: ${msg}`);
    }
  }

  const records = extractRecords(json);
  const warnings: string[] = [];
  const rows: ParsedDay[] = [];
  for (const rec of records) {
    const mapped = mapPunchRecord(rec);
    if (mapped) rows.push(mapped);
    else warnings.push(`Skipped a record with no usable date: ${JSON.stringify(rec).slice(0, 120)}`);
  }

  return {
    rows,
    warnings,
    fetched: records.length,
    rangeStart: from,
    rangeEnd: to,
  };
}
