// Voxbay CDR webhook — the pure half: the signature check, reading the payload,
// and mapping one finished call onto a VoxbayCall row. No DB here, so all of it
// is unit-tested; the route (src/app/api/crm/voxbay/webhook) and
// src/lib/voxbay-webhook-ingest.ts do the I/O.
//
// Voxbay POSTs one call per request, after it ends, and retries anything that
// doesn't get a 2xx (1m, 5m, 15m, 1h, 6h). Every request carries:
//   X-Voxbay-Event       cdr.incoming | cdr.outgoing
//   X-Voxbay-Event-Id    unique per delivery, identical across its retries
//   X-Voxbay-Attempt     1, 2, 3…
//   X-Voxbay-Signature   t=<unix>,v1=<hex>  (two v1 values for 24h after a secret rotation)
//   X-Voxbay-Test        "true" on a test send only
import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePhone } from "./crm";
import { parseVoxbayDate } from "./crm-voxbay-reconcile";

export const VOXBAY_HEADERS = {
  event: "x-voxbay-event",
  eventId: "x-voxbay-event-id",
  attempt: "x-voxbay-attempt",
  signature: "x-voxbay-signature",
  test: "x-voxbay-test",
} as const;

// ── Signature ────────────────────────────────────────────────────────────────

/** `t=<unix>,v1=<hex>[,v1=<hex>]` → its parts, or null when malformed. */
export function parseSignatureHeader(header: string | null | undefined): { t: string; v1: string[] } | null {
  let t: string | null = null;
  const v1: string[] = [];
  for (const part of String(header ?? "").split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) t = value;
    else if (key === "v1" && /^[0-9a-f]+$/i.test(value)) v1.push(value.toLowerCase());
  }
  return t && v1.length ? { t, v1 } : null;
}

/** HMAC-SHA256 hex of `${eventId}.${t}.${rawBody}`, keyed with the signing secret as given. */
export function signVoxbayPayload(secret: string, eventId: string, t: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${eventId}.${t}.${rawBody}`, "utf8").digest("hex");
}

export type VoxbaySignatureVerdict = "valid" | "invalid" | "missing" | "not_configured";

/**
 * Check a delivery's signature against the RAW body — verified before parsing,
 * because JSON.parse → stringify does not round-trip byte for byte.
 *
 * Valid when ANY v1 matches, so deliveries signed with the old secret keep
 * passing through the 24h overlap after a rotation. The event id is inside the
 * HMAC, which is what makes it safe to dedupe on.
 */
export function verifyVoxbaySignature(opts: {
  rawBody: string;
  eventId: string | null | undefined;
  header: string | null | undefined;
  secret: string | null | undefined;
}): VoxbaySignatureVerdict {
  const secret = (opts.secret ?? "").trim();
  if (!secret) return "not_configured";
  const eventId = (opts.eventId ?? "").trim();
  if (!eventId || !(opts.header ?? "").trim()) return "missing";
  const parsed = parseSignatureHeader(opts.header);
  if (!parsed) return "invalid";

  const expected = Buffer.from(signVoxbayPayload(secret, eventId, parsed.t, opts.rawBody), "hex");
  let ok = false;
  for (const candidate of parsed.v1) {
    const got = Buffer.from(candidate, "hex");
    // timingSafeEqual throws on a length mismatch; the digest's fixed length is
    // public anyway, so checking it first leaks nothing.
    if (got.length === expected.length && timingSafeEqual(got, expected)) ok = true;
  }
  return ok ? "valid" : "invalid";
}

// ── Payload ──────────────────────────────────────────────────────────────────

export type VoxbayDirection = "incoming" | "outgoing";

/** One finished call as Voxbay reported it. Fields Voxbay omitted are null. */
export type VoxbayCdr = {
  direction: VoxbayDirection;
  callId: string;
  phone: string | null;
  name: string | null;
  callStatus: string | null;
  didNumber: string | null;
  totalDurationSec: number | null;
  conversationDurationSec: number | null;
  recordingUrl: string | null;
  callStartTime: Date | null;
  callAnsweredTime: Date | null;
  callEndTime: Date | null;
  agentName: string | null;
  agentEmail: string | null;
  agentExtension: string | null;
  agentPhone: string | null;
  departmentName: string | null;
};

/** A payload value as a trimmed string; absent, blank or non-scalar → null. */
function str(body: Record<string, unknown>, key: string): string | null {
  const v = body[key];
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s ? s : null;
}

/**
 * A Voxbay duration as whole seconds. Accepts plain seconds ("125", "125.4") or
 * clock form ("02:05", "00:02:05"); anything else is null, never a guess.
 */
export function parseDurationSeconds(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const [h, mi, sec] = m[3] === undefined ? [0, Number(m[1]), Number(m[2])] : [Number(m[1]), Number(m[2]), Number(m[3])];
  return h * 3600 + mi * 60 + sec;
}

/** Seconds → "HH:MM:SS", the form the report's duration columns use. */
export function formatHms(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Read a CDR body. The direction comes from the payload, falling back to the
 * event name (`cdr.outgoing`, `call_end.outgoing`, …). A call with no call_id
 * or no knowable direction is refused: it couldn't be deduped, or it would be
 * counted on the wrong dashboard.
 */
export function parseVoxbayCdr(
  body: unknown,
  eventType: string | null | undefined,
): { ok: true; cdr: VoxbayCdr } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body_not_object" };
  const b = body as Record<string, unknown>;

  const callId = str(b, "call_id");
  if (!callId) return { ok: false, error: "missing_call_id" };

  const declared = (str(b, "direction") ?? "").toLowerCase();
  const event = (eventType ?? "").toLowerCase();
  const direction: VoxbayDirection | null =
    declared === "incoming" || declared === "outgoing"
      ? declared
      : event.endsWith("outgoing")
        ? "outgoing"
        : event.endsWith("incoming")
          ? "incoming"
          : null;
  if (!direction) return { ok: false, error: "unknown_direction" };

  return {
    ok: true,
    cdr: {
      direction,
      callId,
      phone: str(b, "phone"),
      name: str(b, "name"),
      callStatus: str(b, "call_status"),
      didNumber: str(b, "did_number"),
      totalDurationSec: parseDurationSeconds(str(b, "total_duration")),
      conversationDurationSec: parseDurationSeconds(str(b, "conversation_duration")),
      recordingUrl: str(b, "recording_url"),
      callStartTime: parseVoxbayDate(str(b, "call_start_time")),
      callAnsweredTime: parseVoxbayDate(str(b, "call_answered_time")),
      callEndTime: parseVoxbayDate(str(b, "call_end_time")),
      agentName: str(b, "agent_name"),
      agentEmail: str(b, "agent_email"),
      agentExtension: str(b, "agent_extension"),
      agentPhone: str(b, "agent_phone_number"),
      departmentName: str(b, "department_name"),
    },
  };
}

// ── Status ───────────────────────────────────────────────────────────────────

export type VoxbayCallOutcome = "answered" | "missed" | "busy" | "failed";

/**
 * The report's `user_status` word for each outcome. The incoming-call dashboard
 * (/marketing/voxbay) classifies a call by `user_status`, so a webhook row
 * stores its outcome in that vocabulary and is counted like an uploaded one.
 */
export const OUTCOME_USER_STATUS: Record<VoxbayCallOutcome, string> = {
  answered: "ANSWERED",
  missed: "NOANSWER",
  busy: "BUSY",
  failed: "FAILED",
};

const FAILED_RE = /FAIL|ERROR|REJECT|CONGEST|CHANUNAVAIL|UNAVAILABLE|CHANNEL_?LIMIT|INVALID|UNREACH/;
const MISSED_RE = /NO_?ANSWER|NOT_?ANSWER|UNANSWER|MISS|CANCEL|ABANDON|TIMEOUT|NO_?RESPONSE/;

/**
 * Collapse Voxbay's own call_status onto answered / missed / busy / failed.
 *
 * Talk time wins over the status word. In Voxbay's report an incoming call
 * carries call_status ANSWERED when the IVR picked up, even though no agent
 * ever did (user_status FAILED). So a bare "ANSWERED" counts only when someone
 * was on our end: an agent on an incoming call, or any outgoing call.
 */
export function normalizeVoxbayOutcome(cdr: Pick<VoxbayCdr, "callStatus" | "conversationDurationSec" | "direction" | "agentName" | "agentEmail" | "agentExtension">): VoxbayCallOutcome {
  if ((cdr.conversationDurationSec ?? 0) > 0) return "answered";
  const s = (cdr.callStatus ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  if (s.includes("BUSY")) return "busy";
  if (FAILED_RE.test(s)) return "failed";
  if (MISSED_RE.test(s)) return "missed";
  const agentOnCall = cdr.direction === "outgoing" || !!(cdr.agentName || cdr.agentEmail || cdr.agentExtension);
  if (/ANSWER|CONNECT/.test(s) && agentOnCall) return "answered";
  return "missed";
}

// ── Mapping onto VoxbayCall ──────────────────────────────────────────────────

/**
 * The report upload's identity key for a call: `${sourceNumber}|${didNumber}|${start ISO}`
 * (mirrored by the backfill DDL in /api/master/parties-schema-sync). Null only
 * when all three parts are missing.
 */
export function voxbayCallSignature(
  sourceNumber: string | null,
  didNumber: string | null,
  callStartTime: Date | null,
): string | null {
  if (!sourceNumber && !didNumber && !callStartTime) return null;
  return `${sourceNumber ?? ""}|${didNumber ?? ""}|${callStartTime?.toISOString() ?? ""}`;
}

/** The VoxbayCall columns a webhook call fills (the lead and agent links are resolved separately). */
export type VoxbayCallFields = {
  voxbayCallId: string;
  direction: VoxbayDirection;
  phoneE164: string | null;
  signature: string | null;
  sourceNumber: string | null;
  contactName: string | null;
  didNumber: string | null;
  callStartTime: Date | null;
  callConnectedTime: Date | null;
  callEndTime: Date | null;
  callStatus: string | null;
  userStatus: string;
  callRecordFile: string | null;
  extNumber: string | null;
  agentName: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  deptName: string | null;
  totalDurationSec: number;
  totalDurationDisplay: string;
  answeredDurationSec: number;
  answeredDurationDisplay: string;
};

/**
 * One CDR → the VoxbayCall columns, in the report's own vocabulary so existing
 * reports read webhook rows unchanged: the customer's number is `sourceNumber`
 * (raw) plus `phoneE164`, the recording URL is `callRecordFile` exactly as
 * received, and call_status is kept verbatim beside the derived `userStatus`.
 * Outgoing CDRs carry no total_duration, so it's end − start when both are known.
 */
export function cdrToCallFields(cdr: VoxbayCdr): VoxbayCallFields {
  const answered = cdr.conversationDurationSec ?? 0;
  const span =
    cdr.callStartTime && cdr.callEndTime
      ? Math.max(0, Math.round((cdr.callEndTime.getTime() - cdr.callStartTime.getTime()) / 1000))
      : null;
  const total = cdr.totalDurationSec ?? span ?? answered;
  return {
    voxbayCallId: cdr.callId,
    direction: cdr.direction,
    phoneE164: normalizePhone(cdr.phone),
    signature: voxbayCallSignature(cdr.phone, cdr.didNumber, cdr.callStartTime),
    sourceNumber: cdr.phone,
    contactName: cdr.name,
    didNumber: cdr.didNumber,
    callStartTime: cdr.callStartTime,
    callConnectedTime: cdr.callAnsweredTime,
    callEndTime: cdr.callEndTime,
    callStatus: cdr.callStatus,
    userStatus: OUTCOME_USER_STATUS[normalizeVoxbayOutcome(cdr)],
    callRecordFile: cdr.recordingUrl,
    extNumber: cdr.agentExtension,
    agentName: cdr.agentName,
    agentEmail: cdr.agentEmail,
    agentPhone: cdr.agentPhone,
    deptName: cdr.departmentName,
    totalDurationSec: total,
    totalDurationDisplay: formatHms(total),
    answeredDurationSec: answered,
    answeredDurationDisplay: formatHms(answered),
  };
}

const OUTCOME_LABEL: Record<VoxbayCallOutcome, string> = {
  answered: "Answered",
  missed: "Missed",
  busy: "Busy",
  failed: "Failed",
};

/** "4m 12s" / "45s" / "1h 2m". */
export function shortDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

/**
 * The Timeline line, e.g. "Incoming Voxbay call · Answered · 4m 12s". Voxbay's
 * agent name is appended only when `withAgent` — i.e. it matched no DesGro
 * user, since a matched one is already the entry's actor.
 */
export function voxbayCallSummary(cdr: VoxbayCdr, withAgent = true): string {
  const outcome = normalizeVoxbayOutcome(cdr);
  const parts = [`${cdr.direction === "incoming" ? "Incoming" : "Outgoing"} Voxbay call`, OUTCOME_LABEL[outcome]];
  if (outcome === "answered" && (cdr.conversationDurationSec ?? 0) > 0) parts.push(shortDuration(cdr.conversationDurationSec!));
  if (withAgent && cdr.agentName) parts.push(cdr.agentName);
  return parts.join(" · ");
}

// ── Matching the same call across the webhook and the report upload ──────────

/** What's needed to recognise a call already on file. */
export type CallIdentity = {
  voxbayCallId: string | null;
  signature: string | null;
  phoneE164: string | null;
  callStartTime: Date | null;
};

export type ExistingCall = CallIdentity & { id: string; source: string; leadId?: string | null };

/** Report and webhook clocks for the same call can disagree by a second or so. */
export const CALL_MATCH_TOLERANCE_MS = 2_000;

/**
 * Index rows already on file so a batch of incoming calls can each find theirs:
 * by Voxbay call id, then by the report's signature, then by the same number
 * starting within {@link CALL_MATCH_TOLERANCE_MS}. The last key is what catches
 * a webhook call in a later report when the two spell the number differently
 * ("+91 98…" vs "9198…"), so their signatures differ.
 */
export function indexExistingCalls<T extends ExistingCall>(rows: readonly T[]): (call: CallIdentity) => T | null {
  const byId = new Map<string, T>();
  const bySignature = new Map<string, T>();
  const byPhone = new Map<string, T[]>();
  for (const r of rows) {
    if (r.voxbayCallId) byId.set(r.voxbayCallId, r);
    if (r.signature) bySignature.set(r.signature, r);
    if (r.phoneE164 && r.callStartTime) byPhone.set(r.phoneE164, [...(byPhone.get(r.phoneE164) ?? []), r]);
  }
  return (call) => {
    const id = call.voxbayCallId ? byId.get(call.voxbayCallId) : undefined;
    if (id) return id;
    const sig = call.signature ? bySignature.get(call.signature) : undefined;
    if (sig) return sig;
    if (!call.phoneE164 || !call.callStartTime) return null;
    const at = call.callStartTime.getTime();
    let best: T | null = null;
    let bestGap = Infinity;
    for (const r of byPhone.get(call.phoneE164) ?? []) {
      const gap = Math.abs(r.callStartTime!.getTime() - at);
      if (gap <= CALL_MATCH_TOLERANCE_MS && gap < bestGap) {
        best = r;
        bestGap = gap;
      }
    }
    return best;
  };
}
