import { describe, it, expect } from "vitest";
import {
  buildCandidateWhere,
  candidateOrderBy,
  sortRows,
  candidatesToCsv,
  type ApplicationRowDTO,
} from "@/lib/hiring/candidates";

function row(partial: Partial<ApplicationRowDTO>): ApplicationRowDTO {
  return {
    id: "a1", candidateId: "c1", fullName: "Anu", email: null, phone: null,
    currentTitle: null, currentEmployer: null, locationText: null, resumeUrl: null,
    tags: [], source: "manual", sourceLabel: "Added manually", ownerId: null, ownerName: null,
    jobId: "j1", jobTitle: "BDE", department: "Sales", stageId: "s1", stageName: "Applied",
    stageKind: "open", stagePosition: 0, status: "active", aiScore: null, aiScoredAt: null,
    needsAttention: false, screenedOutReason: null, rejectionReason: null,
    appliedAt: "2026-09-01T00:00:00.000Z", stageEnteredAt: "2026-09-01T00:00:00.000Z",
    lastContactedAt: null, nextFollowUpAt: null, daysInStage: 0, slaBreached: false,
    daysSinceContact: null, interviewCount: 0, noteCount: 0,
    ...partial,
  } as ApplicationRowDTO;
}

describe("candidate list filters", () => {
  it("defaults to active only", () => {
    expect(buildCandidateWhere({}).status).toBe("active");
    expect(buildCandidateWhere({ status: "nonsense" }).status).toBe("active");
  });

  it("drops the status constraint entirely for 'all'", () => {
    expect(buildCandidateWhere({ status: "all" }).status).toBeUndefined();
  });

  it("filters on the flag, not the status, for needs-attention", () => {
    const where = buildCandidateWhere({ status: "needs_attention" });
    expect(where.needsAttention).toBe(true);
    expect(where.status).toBeUndefined();
  });

  it("always hides soft-deleted applications AND soft-deleted people", () => {
    const where = buildCandidateWhere({});
    expect(where.deletedAt).toBeNull();
    expect(where.candidate).toMatchObject({ deletedAt: null });
  });

  it("searches name, email, phone and employer", () => {
    const where = buildCandidateWhere({ q: "Anu" });
    const or = (where.candidate as { OR: unknown[] }).OR;
    expect(or).toHaveLength(4);
  });

  it("lower-cases the email term, because emails are stored lower-cased", () => {
    const where = buildCandidateWhere({ q: "ANU@X.COM" });
    const or = (where.candidate as { OR: { email?: { contains: string } }[] }).OR;
    expect(or.find((c) => c.email)?.email?.contains).toBe("anu@x.com");
  });

  it("applies a minimum score as a floor", () => {
    expect(buildCandidateWhere({ minScore: 70 }).aiScore).toEqual({ gte: 70 });
  });
});

describe("candidate ordering", () => {
  it("defaults to score, high first", () => {
    expect(candidateOrderBy(undefined)).toEqual([{ aiScore: "desc" }, { appliedAt: "desc" }]);
  });

  it("orders by name for A–Z", () => {
    expect(candidateOrderBy("name_asc")).toEqual([{ candidate: { fullName: "asc" } }]);
  });

  it("puts never-contacted first for longest-since-contact", () => {
    const rows = [
      row({ id: "contacted-recently", daysSinceContact: 1 }),
      row({ id: "never", daysSinceContact: null }),
      row({ id: "contacted-long-ago", daysSinceContact: 30 }),
    ];
    expect(sortRows(rows, "longest_since_contact").map((r) => r.id)).toEqual([
      "never",
      "contacted-long-ago",
      "contacted-recently",
    ]);
  });

  it("breaks a tie between two never-contacted by who applied first", () => {
    const rows = [
      row({ id: "newer", daysSinceContact: null, appliedAt: "2026-09-05T00:00:00.000Z" }),
      row({ id: "older", daysSinceContact: null, appliedAt: "2026-09-01T00:00:00.000Z" }),
    ];
    expect(sortRows(rows, "longest_since_contact").map((r) => r.id)).toEqual(["older", "newer"]);
  });

  it("leaves the order alone for every other sort", () => {
    const rows = [row({ id: "a" }), row({ id: "b" })];
    expect(sortRows(rows, "score_desc").map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("candidate CSV export", () => {
  it("writes a header and one row per application", () => {
    const csv = candidatesToCsv([row({ fullName: "Anu", email: "anu@example.com" })]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Anu,anu@example.com");
  });

  it("defuses a formula-triggering name", () => {
    expect(candidatesToCsv([row({ fullName: "=cmd()" })])).toContain("'=cmd()");
  });

  it("says 'no' rather than leaving the attention column blank", () => {
    expect(candidatesToCsv([row({ needsAttention: false })]).split("\r\n")[1]).toMatch(/,no$/);
  });
});
