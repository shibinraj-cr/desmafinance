/**
 * Voxbay CDR webhook: the signature check, reading a payload, the outcome
 * mapping and call matching run for real; the route runs with Prisma and the
 * ingest step mocked, to pin down what each delivery is answered and logged as.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  voxbayWebhookEvent: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
}));
const ingest = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/voxbay-webhook-ingest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/voxbay-webhook-ingest")>()),
  ingestVoxbayCdr: ingest,
}));

import {
  cdrToCallFields,
  indexExistingCalls,
  normalizeVoxbayOutcome,
  parseDurationSeconds,
  parseSignatureHeader,
  parseVoxbayCdr,
  signVoxbayPayload,
  verifyVoxbaySignature,
  voxbayCallSignature,
  voxbayCallSummary,
  type VoxbayCdr,
} from "@/lib/voxbay-webhook";
import { POST } from "@/app/api/crm/voxbay/webhook/route";
import { config as middlewareConfig } from "@/middleware";

const SECRET = "whsec_unit_test_secret";

function cdr(over: Partial<VoxbayCdr> = {}): VoxbayCdr {
  const parsed = parseVoxbayCdr({ call_id: "c1", direction: "incoming", phone: "9876543210" }, null);
  if (!parsed.ok) throw new Error(parsed.error);
  return { ...parsed.cdr, ...over };
}

describe("signature", () => {
  const body = '{"call_id":"c1","direction":"incoming"}';
  const sig = (secret: string, id = "evt_1", t = "1762500000", raw = body) => signVoxbayPayload(secret, id, t, raw);

  it("reads t and every v1 from the header", () => {
    expect(parseSignatureHeader("t=1762500000,v1=AbC123,v1=def456")).toEqual({ t: "1762500000", v1: ["abc123", "def456"] });
    expect(parseSignatureHeader("v1=abc")).toBeNull();
    expect(parseSignatureHeader("t=abc,v1=abc")).toBeNull();
    expect(parseSignatureHeader("")).toBeNull();
  });

  it("accepts the HMAC of `${eventId}.${t}.${rawBody}`", () => {
    const header = `t=1762500000,v1=${sig(SECRET)}`;
    expect(verifyVoxbaySignature({ rawBody: body, eventId: "evt_1", header, secret: SECRET })).toBe("valid");
  });

  it("accepts either v1 during a secret rotation", () => {
    const header = `t=1762500000,v1=${sig("whsec_old")},v1=${sig(SECRET)}`;
    expect(verifyVoxbaySignature({ rawBody: body, eventId: "evt_1", header, secret: SECRET })).toBe("valid");
  });

  it("refuses a changed body, event id or timestamp, and a wrong secret", () => {
    const header = `t=1762500000,v1=${sig(SECRET)}`;
    expect(verifyVoxbaySignature({ rawBody: body + " ", eventId: "evt_1", header, secret: SECRET })).toBe("invalid");
    expect(verifyVoxbaySignature({ rawBody: body, eventId: "evt_2", header, secret: SECRET })).toBe("invalid");
    expect(
      verifyVoxbaySignature({ rawBody: body, eventId: "evt_1", header: header.replace("t=1762500000", "t=1762500001"), secret: SECRET }),
    ).toBe("invalid");
    expect(verifyVoxbaySignature({ rawBody: body, eventId: "evt_1", header, secret: "whsec_other" })).toBe("invalid");
    expect(verifyVoxbaySignature({ rawBody: body, eventId: "evt_1", header: "t=1762500000,v1=abcd", secret: SECRET })).toBe("invalid");
  });

  it("tells a missing signature apart from a missing secret", () => {
    expect(verifyVoxbaySignature({ rawBody: body, eventId: "evt_1", header: null, secret: SECRET })).toBe("missing");
    expect(verifyVoxbaySignature({ rawBody: body, eventId: null, header: "t=1,v1=ab", secret: SECRET })).toBe("missing");
    expect(verifyVoxbaySignature({ rawBody: body, eventId: "evt_1", header: "t=1,v1=ab", secret: "" })).toBe("not_configured");
  });
});

describe("parseDurationSeconds", () => {
  it("takes plain seconds or clock form", () => {
    expect(parseDurationSeconds("125")).toBe(125);
    expect(parseDurationSeconds("125.6")).toBe(126);
    expect(parseDurationSeconds("02:05")).toBe(125);
    expect(parseDurationSeconds("00:02:05")).toBe(125);
    expect(parseDurationSeconds("1:00:00")).toBe(3600);
  });
  it("never guesses", () => {
    expect(parseDurationSeconds(null)).toBeNull();
    expect(parseDurationSeconds("")).toBeNull();
    expect(parseDurationSeconds("2 min")).toBeNull();
  });
});

describe("parseVoxbayCdr", () => {
  it("needs a call_id and a direction", () => {
    expect(parseVoxbayCdr({ direction: "incoming" }, "cdr.incoming")).toEqual({ ok: false, error: "missing_call_id" });
    expect(parseVoxbayCdr({ call_id: "c1" }, "cdr.unknown")).toEqual({ ok: false, error: "unknown_direction" });
    expect(parseVoxbayCdr([1], "cdr.incoming")).toEqual({ ok: false, error: "body_not_object" });
  });

  it("falls back to the event name for the direction", () => {
    const r = parseVoxbayCdr({ call_id: "c1" }, "call_end.outgoing");
    expect(r.ok && r.cdr.direction).toBe("outgoing");
  });

  it("reads ISO times with their offset, and omitted fields as null", () => {
    const r = parseVoxbayCdr(
      { call_id: "c1", direction: "incoming", call_start_time: "2026-11-07T14:28:40+05:30", conversation_duration: "00:01:10" },
      "cdr.incoming",
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.cdr.callStartTime?.toISOString()).toBe("2026-11-07T08:58:40.000Z");
    expect(r.cdr.conversationDurationSec).toBe(70);
    expect(r.cdr.recordingUrl).toBeNull();
    expect(r.cdr.agentEmail).toBeNull();
  });
});

describe("normalizeVoxbayOutcome", () => {
  it("lets talk time win", () => {
    expect(normalizeVoxbayOutcome(cdr({ callStatus: "NOANSWER", conversationDurationSec: 30 }))).toBe("answered");
  });
  it("doesn't count an IVR pick-up on an incoming call as answered", () => {
    expect(normalizeVoxbayOutcome(cdr({ callStatus: "ANSWERED" }))).toBe("missed");
    expect(normalizeVoxbayOutcome(cdr({ callStatus: "ANSWERED", agentName: "Agent One" }))).toBe("answered");
    expect(normalizeVoxbayOutcome(cdr({ direction: "outgoing", callStatus: "ANSWERED" }))).toBe("answered");
  });
  it("maps busy, failures and misses", () => {
    expect(normalizeVoxbayOutcome(cdr({ callStatus: "BUSY" }))).toBe("busy");
    expect(normalizeVoxbayOutcome(cdr({ callStatus: "CHANNEL_LIMIT_EXCEEDED" }))).toBe("failed");
    expect(normalizeVoxbayOutcome(cdr({ callStatus: "Not Answered", agentName: "Agent One" }))).toBe("missed");
    expect(normalizeVoxbayOutcome(cdr({ callStatus: "something new" }))).toBe("missed");
    expect(normalizeVoxbayOutcome(cdr({ callStatus: null }))).toBe("missed");
  });
});

describe("cdrToCallFields", () => {
  it("fills the report's columns in the report's vocabulary", () => {
    const start = new Date("2026-11-07T08:58:40.000Z");
    const url = "https://rec.example.com/a/b.mp3?sig=AbC%2F&x=1";
    const f = cdrToCallFields(
      cdr({ phone: "+91 98765-43210", didNumber: "918000000000", callStartTime: start, recordingUrl: url, conversationDurationSec: 65, totalDurationSec: 80 }),
    );
    expect(f.phoneE164).toBe("+919876543210");
    expect(f.sourceNumber).toBe("+91 98765-43210");
    expect(f.callRecordFile).toBe(url);
    expect(f.userStatus).toBe("ANSWERED");
    expect(f.answeredDurationDisplay).toBe("00:01:05");
    expect(f.totalDurationDisplay).toBe("00:01:20");
    expect(f.signature).toBe(voxbayCallSignature("+91 98765-43210", "918000000000", start));
  });

  it("derives an outgoing call's total from its start and end", () => {
    const f = cdrToCallFields(
      cdr({ direction: "outgoing", callStartTime: new Date("2026-11-07T09:00:00Z"), callEndTime: new Date("2026-11-07T09:00:42Z") }),
    );
    expect(f.totalDurationSec).toBe(42);
    expect(f.answeredDurationSec).toBe(0);
    expect(f.userStatus).toBe("NOANSWER");
  });

  it("summarises the call for the Timeline", () => {
    expect(voxbayCallSummary(cdr({ conversationDurationSec: 252, agentName: "Agent One" }))).toBe("Incoming Voxbay call · Answered · 4m 12s · Agent One");
    expect(voxbayCallSummary(cdr({ direction: "outgoing", callStatus: "BUSY" }))).toBe("Outgoing Voxbay call · Busy");
    expect(voxbayCallSummary(cdr({ conversationDurationSec: 30, agentName: "Agent One" }), false)).toBe("Incoming Voxbay call · Answered · 30s");
  });
});

describe("indexExistingCalls", () => {
  const at = (s: string) => new Date(`2026-11-07T09:00:${s}Z`);
  const rows = [
    { id: "byId", voxbayCallId: "c1", signature: null, phoneE164: null, callStartTime: null, source: "webhook" },
    { id: "bySig", voxbayCallId: null, signature: "S", phoneE164: null, callStartTime: null, source: "upload" },
    { id: "near", voxbayCallId: null, signature: null, phoneE164: "+919876543210", callStartTime: at("01"), source: "webhook" },
    { id: "nearer", voxbayCallId: null, signature: null, phoneE164: "+919876543210", callStartTime: at("10"), source: "webhook" },
  ];
  const find = indexExistingCalls(rows);
  const call = (o: Partial<Parameters<typeof find>[0]>) => ({ voxbayCallId: null, signature: null, phoneE164: null, callStartTime: null, ...o });

  it("prefers the call id, then the signature, then number + time", () => {
    expect(find(call({ voxbayCallId: "c1", signature: "S" }))?.id).toBe("byId");
    expect(find(call({ voxbayCallId: "other", signature: "S" }))?.id).toBe("bySig");
    expect(find(call({ phoneE164: "+919876543210", callStartTime: at("02") }))?.id).toBe("near");
  });
  it("matches number + time only within the tolerance, closest first", () => {
    expect(find(call({ phoneE164: "+919876543210", callStartTime: at("09") }))?.id).toBe("nearer");
    expect(find(call({ phoneE164: "+919876543210", callStartTime: at("05") }))).toBeNull();
    expect(find(call({ phoneE164: "+910000000000", callStartTime: at("01") }))).toBeNull();
  });
});

describe("POST /api/crm/voxbay/webhook", () => {
  const payload = { call_id: "c1", direction: "incoming", phone: "9876543210", call_status: "ANSWERED" };

  function request(opts: { body?: string; eventId?: string; secret?: string; test?: boolean; sign?: boolean } = {}) {
    const raw = opts.body ?? JSON.stringify(payload);
    const eventId = opts.eventId ?? "evt_1";
    const t = "1762500000";
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-voxbay-event": "cdr.incoming",
      "x-voxbay-event-id": eventId,
      "x-voxbay-attempt": "2",
    };
    if (opts.sign !== false) headers["x-voxbay-signature"] = `t=${t},v1=${signVoxbayPayload(opts.secret ?? SECRET, eventId, t, raw)}`;
    if (opts.test) headers["x-voxbay-test"] = "true";
    return new Request("http://local/api/crm/voxbay/webhook", { method: "POST", headers, body: raw });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VOXBAY_SIGNING_SECRET = SECRET;
    db.voxbayWebhookEvent.findUnique.mockResolvedValue(null);
    db.voxbayWebhookEvent.create.mockResolvedValue({});
    db.voxbayWebhookEvent.upsert.mockResolvedValue({});
    ingest.mockResolvedValue({ status: "processed", callRowId: "row1", leadId: "lead1", leadCreated: false });
  });

  it("is closed without a secret", async () => {
    delete process.env.VOXBAY_SIGNING_SECRET;
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("refuses a bad signature and logs it without the claimed event id", async () => {
    const res = await POST(request({ secret: "whsec_wrong" }));
    expect(res.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
    expect(db.voxbayWebhookEvent.upsert).not.toHaveBeenCalled();
    const logged = db.voxbayWebhookEvent.create.mock.calls[0][0].data;
    expect(logged).toMatchObject({ signatureOk: false, status: "error", callId: "c1", attempt: 2 });
    expect(logged.eventId).toBeUndefined();
    expect(logged.error).toContain("claimed event evt_1");
  });

  it("refuses an unsigned request", async () => {
    expect((await POST(request({ sign: false }))).status).toBe(401);
  });

  it("answers a repeat of a filed delivery as a duplicate without filing it again", async () => {
    db.voxbayWebhookEvent.findUnique.mockResolvedValue({ status: "processed" });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("retries a delivery whose earlier attempt failed", async () => {
    db.voxbayWebhookEvent.findUnique.mockResolvedValue({ status: "error" });
    expect((await POST(request())).status).toBe(200);
    expect(ingest).toHaveBeenCalledOnce();
  });

  it("logs a test send and files nothing", async () => {
    const res = await POST(request({ test: true }));
    expect(res.status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
    expect(db.voxbayWebhookEvent.upsert.mock.calls[0][0]).toMatchObject({
      where: { eventId: "evt_1" },
      create: { eventId: "evt_1", isTest: true, status: "test", signatureOk: true },
    });
  });

  it("answers 400 for a signed payload it can't use", async () => {
    const res = await POST(request({ body: JSON.stringify({ direction: "incoming" }) }));
    expect(res.status).toBe(400);
    expect(db.voxbayWebhookEvent.upsert.mock.calls[0][0].create).toMatchObject({ status: "error", error: "missing_call_id" });
    expect((await POST(request({ body: "not json" }))).status).toBe(400);
  });

  it("files a valid call", async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "processed", linked: true, leadCreated: false });
    const [parsed, event] = ingest.mock.calls[0];
    expect(parsed).toMatchObject({ callId: "c1", direction: "incoming", phone: "9876543210" });
    expect(event).toMatchObject({ eventId: "evt_1", eventType: "cdr.incoming", attempt: 2 });
  });

  it("answers 500 when the call can't be stored, so Voxbay retries", async () => {
    ingest.mockRejectedValue(new Error("db down"));
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(db.voxbayWebhookEvent.upsert.mock.calls[0][0].update).toMatchObject({ status: "error", error: "db down" });
  });
});

describe("middleware", () => {
  const gated = (path: string) => new RegExp(`^${middlewareConfig.matcher[0]}$`).test(path);
  it("lets Voxbay reach the webhook and nothing else around it", () => {
    expect(gated("/api/crm/voxbay/webhook")).toBe(false);
    expect(gated("/api/crm/voxbay-reconcile")).toBe(true);
    expect(gated("/api/marketing/voxbay/upload")).toBe(true);
  });
});
