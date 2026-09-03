import { describe, it, expect } from "vitest";
import {
  partnerJobWhere,
  partnerSubmissionWhere,
  partnerApplicationWhere,
  PARTNER_CANDIDATE_SELECT,
  PARTNER_APPLICATION_SELECT,
  PARTNER_FORBIDDEN_FIELDS,
  hashToken,
  mintToken,
  tokensMatch,
} from "@/lib/hiring/partner-scope";
import { ROLE_PERMISSIONS } from "@/lib/hiring/rbac";

/**
 * The partner boundary is a security boundary (§10), and the spec asks for a
 * test that FAILS BY DEFAULT. That is what these are: each one asserts that a
 * scope clause actually constrains. Delete the constraint and the test goes
 * red, rather than quietly passing because the query "still works".
 */
describe("a partner sees only the jobs granted to them", () => {
  it("constrains to the granted ids", () => {
    const where = partnerJobWhere(["job-1", "job-2"]);
    expect(where.id).toEqual({ in: ["job-1", "job-2"] });
  });

  it("matches NOTHING when nothing has been granted", () => {
    // The dangerous bug is an unconstrained query that reads as "no filter".
    const where = partnerJobWhere([]);
    expect(where.id).toEqual({ in: [] });
    expect(where.id).not.toBeUndefined();
  });

  it("never exposes a draft or closed requisition", () => {
    expect(partnerJobWhere(["job-1"]).status).toEqual({ in: ["live", "paused"] });
  });

  it("hides soft-deleted requisitions", () => {
    expect(partnerJobWhere(["job-1"]).deletedAt).toBeNull();
  });
});

describe("a partner sees only their own submissions", () => {
  it("scopes by partner AND by granted job", () => {
    const where = partnerSubmissionWhere("partner-a", ["job-1"]);
    expect(where.partnerId).toBe("partner-a");
    expect(where.jobId).toEqual({ in: ["job-1"] });
  });

  it("cannot be widened to another partner", () => {
    const where = partnerSubmissionWhere("partner-a", ["job-1"]);
    // There is no code path that produces a submission scope without a
    // partnerId; if this ever becomes undefined, every partner sees every
    // submission.
    expect(where.partnerId).toBeDefined();
    expect(where.partnerId).not.toBe("partner-b");
  });

  it("returns nothing when access to the job was revoked", () => {
    expect(partnerSubmissionWhere("partner-a", []).jobId).toEqual({ in: [] });
  });
});

describe("a partner sees only applications they themselves submitted", () => {
  const where = partnerApplicationWhere("partner-a", ["job-1"]);

  it("requires BOTH the granted job and their own submission", () => {
    // Job alone would leak another agency's candidates on a shared req;
    // submission alone would survive access being revoked.
    expect(where.jobId).toEqual({ in: ["job-1"] });
    expect(where.partnerSub).toEqual({ partnerId: "partner-a" });
  });

  it("still hides soft-deleted applications", () => {
    expect(where.deletedAt).toBeNull();
  });

  it("matches nothing at all with no grants", () => {
    expect(partnerApplicationWhere("partner-a", []).jobId).toEqual({ in: [] });
  });
});

describe("the partner projection is an allow-list, not a deny-list", () => {
  it("never selects a score, a flag, a note or an internal reason", () => {
    const selected = new Set([
      ...Object.keys(PARTNER_APPLICATION_SELECT),
      ...Object.keys(PARTNER_CANDIDATE_SELECT),
    ]);
    for (const forbidden of PARTNER_FORBIDDEN_FIELDS) {
      expect(selected.has(forbidden)).toBe(false);
    }
  });

  it("selects only what a partner needs to chase their own placement", () => {
    expect(Object.keys(PARTNER_APPLICATION_SELECT).sort()).toEqual(
      ["id", "status", "appliedAt", "stage", "job", "candidate"].sort(),
    );
  });

  it("does not leak owner, tags, consent or CTC on the candidate", () => {
    for (const field of ["ownerId", "tags", "consentAt", "expectedCtcLakh", "currentCtcLakh", "humanEditedFields"]) {
      expect(Object.keys(PARTNER_CANDIDATE_SELECT)).not.toContain(field);
    }
  });
});

describe("the partner role holds no internal permission", () => {
  it("cannot read candidates, analytics, offers or the team", () => {
    for (const key of ["candidate:read", "candidate:write", "candidate:move", "analytics:read", "offer:manage", "team:manage", "automation:manage"] as const) {
      expect(ROLE_PERMISSIONS.partner).not.toContain(key);
    }
  });

  it("holds exactly the four keys the portal needs", () => {
    expect([...ROLE_PERMISSIONS.partner].sort()).toEqual(
      ["job:read", "submission:write", "self:read", "self:write"].sort(),
    );
  });
});

describe("partner session tokens", () => {
  it("stores only a hash", () => {
    const { raw, hash } = mintToken();
    expect(hash).toBe(hashToken(raw));
    expect(hash).not.toContain(raw);
    expect(hash).toHaveLength(64);
  });

  it("compares in constant time and rejects a different length outright", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "abd")).toBe(false);
    expect(tokensMatch("abc", "abcd")).toBe(false);
  });
});
