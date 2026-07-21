import { describe, it, expect } from "vitest";
import {
  toWabisPhone,
  toAgentPhone,
  istTimestamp,
  parseAgentOverrides,
  resolveAgent,
  buildLeadAssignedPayload,
  leadAssignedDedupeKey,
  nextAttemptDelayMinutes,
  LEAD_ASSIGNED_EVENT,
  LEAD_SKIPPED_EVENT,
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

describe("parseAgentOverrides", () => {
  it("keeps only entries that actually override something", () => {
    const raw = JSON.stringify({
      u1: { agent: "Priya" },
      u2: { agent: "", phone: "" },
      u3: { phone: "+919000000001" },
    });
    expect(parseAgentOverrides(raw)).toEqual({
      u1: { agent: "Priya" },
      u3: { phone: "+919000000001" },
    });
  });
  it("degrades to no overrides rather than throwing on bad settings data", () => {
    expect(parseAgentOverrides("not json")).toEqual({});
    expect(parseAgentOverrides("[1,2,3]")).toEqual({});
    expect(parseAgentOverrides(JSON.stringify({ u1: "Priya" }))).toEqual({});
    expect(parseAgentOverrides(null)).toEqual({});
    expect(parseAgentOverrides("")).toEqual({});
  });
});

describe("resolveAgent", () => {
  const role = { userId: "u1", displayName: "Priya Example", phone: "9000000001" };

  it("defaults to the consultant's own name and number", () => {
    expect(resolveAgent(role)).toEqual({ agent: "Priya Example", agentPhone: "+919000000001" });
  });
  it("prefers an override where Wabis spells the agent differently", () => {
    expect(resolveAgent({ ...role, overrides: { u1: { agent: "Priya" } } })).toEqual({
      agent: "Priya",
      agentPhone: "+919000000001",
    });
  });
  it("overrides the number independently of the name", () => {
    expect(resolveAgent({ ...role, overrides: { u1: { phone: "+919000000000" } } })).toEqual({
      agent: "Priya Example",
      agentPhone: "+919000000000",
    });
  });
  it("uses an override phone verbatim — it is the exact text shown in the message", () => {
    // E.164 can't express an extension; normalising this would corrupt it.
    expect(resolveAgent({ ...role, overrides: { u1: { phone: "0484 123 4567 ext 9" } } }).agentPhone).toBe(
      "0484 123 4567 ext 9",
    );
  });
  it("ignores an override belonging to a different consultant", () => {
    expect(resolveAgent({ ...role, overrides: { u2: { agent: "Rahul Example" } } }).agent).toBe("Priya Example");
  });
  it("yields an empty agent phone when the consultant has no number on file", () => {
    expect(resolveAgent({ ...role, phone: null }).agentPhone).toBe("");
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

describe("event names", () => {
  it("keeps an unsendable lead off the real dedupe key", () => {
    // A skipped row must not look like a delivery, or fixing the lead's number
    // and reassigning would stay blocked forever.
    expect(LEAD_SKIPPED_EVENT).not.toBe(LEAD_ASSIGNED_EVENT);
    expect(leadAssignedDedupeKey("lead1", "u1").startsWith(LEAD_ASSIGNED_EVENT)).toBe(true);
  });
});
