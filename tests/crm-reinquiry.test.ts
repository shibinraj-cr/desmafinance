import { describe, it, expect } from "vitest";
import {
  isLostStatusCode,
  LOST_STATUS_CODES,
  buildReInquirySummary,
  buildReInquiryTaskSubject,
  buildReInquiryTaskNote,
  buildSupervisorDigest,
  type ReInquiryOutcome,
} from "@/lib/crm-reinquiry";

describe("isLostStatusCode", () => {
  it("is true for the lost dispositions", () => {
    for (const c of LOST_STATUS_CODES) expect(isLostStatusCode(c)).toBe(true);
  });
  it("is false for active / won / unknown / nullish", () => {
    expect(isLostStatusCode("not_yet_started")).toBe(false);
    expect(isLostStatusCode("follow_up")).toBe(false);
    expect(isLostStatusCode("enrolled")).toBe(false);
    expect(isLostStatusCode("re_marketing")).toBe(false);
    expect(isLostStatusCode("duplicate")).toBe(false);
    expect(isLostStatusCode(null)).toBe(false);
    expect(isLostStatusCode(undefined)).toBe(false);
    expect(isLostStatusCode("")).toBe(false);
  });
});

describe("buildReInquirySummary", () => {
  it("notes the revival when a lost lead is re-opened", () => {
    const s = buildReInquirySummary({ fromStatus: "Not Interested", revived: true, campaign: "GF | Kerala" });
    expect(s).toContain("via GF | Kerala");
    expect(s).toContain("Not Interested");
    expect(s).toContain("Re-marketing");
  });
  it("falls back to the source when there is no campaign, and omits revival text", () => {
    const s = buildReInquirySummary({ fromStatus: "Follow-Up", revived: false, source: "Meta" });
    expect(s).toContain("via Meta");
    expect(s).not.toContain("Re-marketing");
  });
  it("has no 'via' clause when neither campaign nor source is present", () => {
    const s = buildReInquirySummary({ fromStatus: "Qualify", revived: false });
    expect(s).not.toContain("via");
  });
});

describe("buildReInquiryTaskSubject", () => {
  it("includes the candidate name and campaign", () => {
    expect(buildReInquiryTaskSubject("Asha K", "Meta GCC")).toBe("Re-inquiry — Asha K re-submitted via Meta GCC");
  });
  it("omits the campaign clause when absent", () => {
    expect(buildReInquiryTaskSubject("Asha K", null)).toBe("Re-inquiry — Asha K re-submitted");
  });
});

describe("buildReInquiryTaskNote", () => {
  it("summarises the submission, prior status and total count", () => {
    const note = buildReInquiryTaskNote({
      fromStatus: "Not Interested",
      revived: true,
      campaign: "GF | Kerala",
      when: new Date("2026-06-21T10:00:00Z"),
      count: 3,
    });
    expect(note).toContain("2026-06-21");
    expect(note).toContain("GF | Kerala");
    expect(note).toContain("Not Interested");
    expect(note).toContain("Auto-revived");
    expect(note).toContain("3");
  });
  it("drops the revival sentence when not revived", () => {
    const note = buildReInquiryTaskNote({ fromStatus: "Follow-Up", revived: false, when: new Date("2026-01-01T00:00:00Z"), count: 2 });
    expect(note).not.toContain("Auto-revived");
  });
});

describe("buildSupervisorDigest", () => {
  const mk = (over: Partial<ReInquiryOutcome>): ReInquiryOutcome => ({
    leadId: "lead1",
    leadName: "Asha K",
    ownerId: "bde1",
    revived: false,
    fromStatus: "Follow-Up",
    inquiryCount: 2,
    source: "Meta",
    campaign: "GF | Kerala",
    occurredAt: new Date("2026-06-21T10:00:00Z"),
    ...over,
  });

  it("counts revivals in the subject", () => {
    const { subject } = buildSupervisorDigest([mk({ revived: true, fromStatus: "Not Interested" }), mk({})]);
    expect(subject).toContain("2 re-inquiries");
    expect(subject).toContain("1 revived");
  });

  it("singularises a single re-inquiry and marks unassigned leads", () => {
    const { subject, text } = buildSupervisorDigest([mk({ ownerId: null })]);
    expect(subject).toContain("1 re-inquiry");
    expect(text).toContain("[UNASSIGNED]");
  });

  it("includes a clickable lead link when a base URL is given", () => {
    const { text } = buildSupervisorDigest([mk({})], "https://app.example.com/");
    expect(text).toContain("https://app.example.com/crm/leads/lead1");
  });

  it("omits links when no base URL is given", () => {
    const { text } = buildSupervisorDigest([mk({})]);
    expect(text).not.toContain("http");
  });
});
