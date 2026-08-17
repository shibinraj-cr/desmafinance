import { describe, it, expect } from "vitest";
import {
  toWabisPhone,
  toAgentPhone,
  istTimestamp,
  resolveAgent,
  isWabisWebhookUrl,
  pickEndpoint,
  STUDY_ABROAD_EVENT,
  CONSULTANT_ROUTED_EVENTS,
  buildLeadAssignedPayload,
  buildLeadAssignedCloudParams,
  leadAssignedDedupeKey,
  nextAttemptDelayMinutes,
  LEAD_ASSIGNED_EVENT,
  LEAD_SKIPPED_EVENT,
  isDeliveredResponse,
} from "@/lib/crm-webhook";

describe("toWabisPhone", () => {
  it("renders a subscriber number as digits only, no plus or separators", () => {
    expect(toWabisPhone("+91 98765 43210")).toBe("919876543210");
    expect(toWabisPhone("+91-9876-543210")).toBe("919876543210");
  });
  it("applies the CRM's +91 default to a bare 10-digit mobile", () => {
    expect(toWabisPhone("9876543210")).toBe("919876543210");
  });
  it("strips a leading-zero trunk or access code", () => {
    expect(toWabisPhone("09876543210")).toBe("919876543210");
    expect(toWabisPhone("00919876543210")).toBe("919876543210");
  });
  it("keeps a non-Indian country code intact", () => {
    expect(toWabisPhone("+447911123456")).toBe("447911123456");
  });
  it("is null when there is nothing sendable", () => {
    expect(toWabisPhone(null)).toBeNull();
    expect(toWabisPhone("")).toBeNull();
    expect(toWabisPhone("n/a")).toBeNull();
    expect(toWabisPhone("12345")).toBeNull();
  });
});

describe("toAgentPhone", () => {
  it("keeps the leading + — this is display text inside the message", () => {
    expect(toAgentPhone("9000000001")).toBe("+919000000001");
    expect(toAgentPhone("+919000000001")).toBe("+919000000001");
  });
  it("falls back to what was stored when it can't be normalised", () => {
    expect(toAgentPhone("call reception")).toBe("call reception");
  });
  it("is an empty string when unset, never null", () => {
    expect(toAgentPhone(null)).toBe("");
    expect(toAgentPhone("   ")).toBe("");
  });
});

describe("istTimestamp", () => {
  it("renders IST wall-clock with an explicit +05:30 offset", () => {
    expect(istTimestamp(new Date("2026-07-21T08:54:00Z"))).toBe("2026-07-21T14:24:00+05:30");
  });
  it("rolls the date over when UTC evening is IST next-morning", () => {
    expect(istTimestamp(new Date("2026-07-21T19:30:00Z"))).toBe("2026-07-22T01:00:00+05:30");
  });
});

describe("resolveAgent", () => {
  const role = { displayName: "Priya Example", phone: "9000000001" };

  it("defaults to the consultant's own name and number", () => {
    expect(resolveAgent(role)).toEqual({ agent: "Priya Example", agentPhone: "+919000000001" });
    expect(resolveAgent({ ...role, endpoint: null })).toEqual({
      agent: "Priya Example",
      agentPhone: "+919000000001",
    });
  });
  it("prefers the endpoint's name where Wabis spells the agent differently", () => {
    expect(resolveAgent({ ...role, endpoint: { agentName: "Priya", agentPhone: null } })).toEqual({
      agent: "Priya",
      agentPhone: "+919000000001",
    });
  });
  it("overrides the number independently of the name", () => {
    expect(resolveAgent({ ...role, endpoint: { agentName: null, agentPhone: "+919000000000" } })).toEqual({
      agent: "Priya Example",
      agentPhone: "+919000000000",
    });
  });
  it("uses an override phone verbatim — it is the exact text shown in the message", () => {
    // E.164 can't express an extension; normalising this would corrupt it.
    expect(
      resolveAgent({ ...role, endpoint: { agentName: null, agentPhone: "0484 123 4567 ext 9" } }).agentPhone,
    ).toBe("0484 123 4567 ext 9");
  });
  it("treats blank overrides as absent rather than blanking the name", () => {
    expect(resolveAgent({ ...role, endpoint: { agentName: "   ", agentPhone: "  " } })).toEqual({
      agent: "Priya Example",
      agentPhone: "+919000000001",
    });
  });
  it("yields an empty agent phone when the consultant has no number on file", () => {
    expect(resolveAgent({ ...role, phone: null }).agentPhone).toBe("");
  });
});

describe("pickEndpoint", () => {
  const own = { id: "own", consultantId: "u1", isDefault: false };
  const other = { id: "other", consultantId: "u2", isDefault: false };
  const fallback = { id: "fallback", consultantId: null, isDefault: true };

  it("routes a consultant to their own workflow", () => {
    // The whole point of per-consultant endpoints: the chat must land in the
    // inbox of whoever actually owns the lead.
    expect(pickEndpoint([fallback, other, own], "u1")?.id).toBe("own");
  });
  it("prefers the consultant's own workflow over the default, whatever the order", () => {
    expect(pickEndpoint([own, fallback], "u1")?.id).toBe("own");
    expect(pickEndpoint([fallback, own], "u1")?.id).toBe("own");
  });
  it("falls back to the default when the consultant is unmapped", () => {
    expect(pickEndpoint([other, fallback], "u1")?.id).toBe("fallback");
  });
  it("returns null when there is no match and no default", () => {
    expect(pickEndpoint([other], "u1")).toBeNull();
    expect(pickEndpoint([], "u1")).toBeNull();
  });
  it("never routes one consultant's leads to another's workflow", () => {
    expect(pickEndpoint([other], "u1")).toBeNull();
  });
});

describe("consultant-routed events / purposes", () => {
  it("study-abroad is a distinct event from the assignment intro", () => {
    // They double as endpoint `purpose` values, so they must not collide — a
    // study-abroad send must resolve the study_abroad workflow, not the intro one.
    expect(STUDY_ABROAD_EVENT).not.toBe(LEAD_ASSIGNED_EVENT);
  });
  it("both are consultant-routed (retry re-resolves their destination)", () => {
    expect(CONSULTANT_ROUTED_EVENTS.has(LEAD_ASSIGNED_EVENT)).toBe(true);
    expect(CONSULTANT_ROUTED_EVENTS.has(STUDY_ABROAD_EVENT)).toBe(true);
  });
  it("does not treat the skipped/test diagnostics as consultant-routed", () => {
    expect(CONSULTANT_ROUTED_EVENTS.has("lead_assigned_skipped")).toBe(false);
    expect(CONSULTANT_ROUTED_EVENTS.has("test")).toBe(false);
  });
});

describe("isWabisWebhookUrl", () => {
  it("accepts a Wabis workflow callback URL", () => {
    // Shape only — the id segments are deliberately fake. A real workflow URL is
    // a bearer credential: anyone holding one can trigger it and send WhatsApp as
    // us, so it must never sit in a public repository, least of all in a fixture
    // where it looks like test data. isWabisWebhookUrl checks nothing but https
    // and a /webhook/ path, so nothing is lost by anonymising it.
    expect(isWabisWebhookUrl("https://bot.wabis.in/webhook/whatsapp-workflow/000000.000000.000000.0000000000")).toBe(
      true,
    );
  });
  it("accepts a self-hosted or rebranded Wabis host", () => {
    // Pinning the host would break a self-hosted instance for no safety gain.
    expect(isWabisWebhookUrl("https://chat.example.com/webhook/whatsapp-workflow/1")).toBe(true);
  });
  it("rejects plaintext http — the payload carries a candidate's name and number", () => {
    expect(isWabisWebhookUrl("http://bot.wabis.in/webhook/whatsapp-workflow/1")).toBe(false);
  });
  it("rejects a URL that isn't a webhook path", () => {
    expect(isWabisWebhookUrl("https://bot.wabis.in/dashboard")).toBe(false);
  });
  it("rejects junk", () => {
    expect(isWabisWebhookUrl("")).toBe(false);
    expect(isWabisWebhookUrl("   ")).toBe(false);
    expect(isWabisWebhookUrl("not a url")).toBe(false);
  });
});

describe("buildLeadAssignedPayload", () => {
  const base = {
    leadId: "cmrufslcm00tpjo0450c005v8",
    candidateName: "Test Candidate",
    phone: "+919876543210",
    email: "candidate@example.com",
    source: "Meta",
    service: null,
    status: "Not Yet Started",
    assignedAt: new Date("2026-07-21T08:54:00Z"),
    agent: "Priya",
    agentPhone: "+919000000001",
  };

  it("produces exactly the payload Wabis is mapped against", () => {
    expect(buildLeadAssignedPayload(base)).toEqual({
      name: "Test Candidate",
      phone: "919876543210",
      email: "candidate@example.com",
      agent: "Priya",
      agent_phone: "+919000000001",
      consultant: "Priya",
      source: "Meta",
      service: "",
      status: "Not Yet Started",
      lead_id: "cmrufslcm00tpjo0450c005v8",
      assigned_at: "2026-07-21T14:24:00+05:30",
    });
  });

  it("always emits every key, so Wabis's field mapping can't come unbound", () => {
    const sparse = buildLeadAssignedPayload({
      ...base,
      candidateName: null,
      email: null,
      source: null,
      status: null,
    });
    expect(Object.keys(sparse!).sort()).toEqual(
      ["agent", "agent_phone", "assigned_at", "consultant", "email", "lead_id", "name", "phone", "service", "source", "status"].sort(),
    );
    expect(sparse!.email).toBe("");
    expect(sparse!.source).toBe("");
  });

  it("mirrors agent into consultant for traceability", () => {
    const p = buildLeadAssignedPayload({ ...base, agent: "Rahul Example" })!;
    expect(p.consultant).toBe(p.agent);
  });

  it("is null when the lead has no number Wabis could key a subscriber on", () => {
    expect(buildLeadAssignedPayload({ ...base, phone: null })).toBeNull();
    expect(buildLeadAssignedPayload({ ...base, phone: "not a phone" })).toBeNull();
  });
});

describe("buildLeadAssignedCloudParams", () => {
  it("maps agent then agent_phone onto Meta's positional {{1}}/{{2}}", () => {
    // Order inferred from Wabis's own #!agent!# / #!agent_phone!# sequence — see
    // the caveat on LEAD_ASSIGNED_CLOUD_TEMPLATE. This test pins that assumption
    // so a future change to it is deliberate, not accidental.
    expect(buildLeadAssignedCloudParams("Priya", "+919000000001")).toEqual({
      "1": "Priya",
      "2": "+919000000001",
    });
  });
});

describe("leadAssignedDedupeKey", () => {
  it("is stable for the same lead and consultant, so a repeat assign never re-sends", () => {
    expect(leadAssignedDedupeKey("lead1", "u1")).toBe(leadAssignedDedupeKey("lead1", "u1"));
  });
  it("distinguishes a genuine handover to someone else", () => {
    expect(leadAssignedDedupeKey("lead1", "u1")).not.toBe(leadAssignedDedupeKey("lead1", "u2"));
  });
});

describe("nextAttemptDelayMinutes", () => {
  it("backs off between the three attempts, then gives up", () => {
    expect(nextAttemptDelayMinutes(1)).toBe(2);
    expect(nextAttemptDelayMinutes(2)).toBe(12);
    expect(nextAttemptDelayMinutes(3)).toBeNull();
  });
  it("terminates for any attempt count, so a delivery can't retry forever", () => {
    expect(nextAttemptDelayMinutes(4)).toBeNull();
    expect(nextAttemptDelayMinutes(99)).toBeNull();
  });
});

describe("isDeliveredResponse", () => {
  it("treats Wabis's HTTP-200 rejection as a failure, not a send", () => {
    // Wabis answers 200 and puts the real outcome in the body.
    expect(isDeliveredResponse(true, '{"status":0,"message":"Bad request. No webhook configuration found.."}')).toBe(
      false,
    );
    expect(isDeliveredResponse(true, '{"success":false}')).toBe(false);
    expect(isDeliveredResponse(true, '{"error":"nope"}')).toBe(false);
  });
  it("accepts a positive status", () => {
    expect(isDeliveredResponse(true, '{"status":1,"message":"queued"}')).toBe(true);
    expect(isDeliveredResponse(true, '{"status":"success"}')).toBe(true);
  });
  it("trusts a 2xx when the body is empty or not JSON", () => {
    expect(isDeliveredResponse(true, "")).toBe(true);
    expect(isDeliveredResponse(true, "   ")).toBe(true);
    expect(isDeliveredResponse(true, "OK")).toBe(true);
    expect(isDeliveredResponse(true, "<html>fine</html>")).toBe(true);
  });
  it("never rescues a non-2xx", () => {
    expect(isDeliveredResponse(false, '{"status":1}')).toBe(false);
    expect(isDeliveredResponse(false, "")).toBe(false);
  });
});

describe("event names", () => {
  it("keeps an unsendable lead off the real dedupe key", () => {
    // A skipped row must not look like a delivery, or fixing the lead's number
    // and reassigning would stay blocked forever.
    expect(LEAD_SKIPPED_EVENT).not.toBe(LEAD_ASSIGNED_EVENT);
    expect(leadAssignedDedupeKey("lead1", "u1").startsWith(LEAD_ASSIGNED_EVENT)).toBe(true);
  });
});
