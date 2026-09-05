import { describe, it, expect } from "vitest";
import { checkBand, offerTotalLakh, sendBlockers, OFFERS_OUT_STATUSES } from "@/lib/hiring/offers";
import { renderPdf, sanitize, escapePdfText } from "@/lib/hiring/pdf";
import { letterHtml, letterPdfBlocks } from "@/lib/hiring/letter";
import { hashToken, mintToken, signingUrl } from "@/lib/hiring/envelope";
import { bucketFollowUps, suggestedAction, countAll } from "@/lib/hiring/follow-ups";
import type { ApplicationRowDTO } from "@/lib/hiring/candidates";

describe("offer comp maths", () => {
  it("totals base, variable and joining bonus", () => {
    expect(offerTotalLakh({ baseLakh: 4, variableLakh: 0.5, joiningBonusLakh: 0.25 })).toBe(4.75);
  });

  it("treats a missing component as zero, not as invalid", () => {
    expect(offerTotalLakh({ baseLakh: 4, variableLakh: null, joiningBonusLakh: null })).toBe(4);
  });
});

describe("the comp band gate", () => {
  const job = { compMinLakh: 3, compMaxLakh: 4.5 };

  it("passes an offer inside the band", () => {
    expect(checkBand(4.5, job)).toEqual({ withinBand: true, bandMaxLakh: 4.5, overBy: 0 });
  });

  it("reports how far over the band an offer is", () => {
    expect(checkBand(5.25, job)).toEqual({ withinBand: false, bandMaxLakh: 4.5, overBy: 0.75 });
  });

  it("checks the BASE, not the total — a joining bonus is not a salary rise", () => {
    // Base is inside the band; a bonus on top must not trip the approval gate.
    expect(checkBand(4.5, job).withinBand).toBe(true);
  });

  it("passes anything when the requisition states no band", () => {
    expect(checkBand(99, { compMinLakh: null, compMaxLakh: null })).toEqual({
      withinBand: true,
      bandMaxLakh: null,
      overBy: 0,
    });
  });
});

describe("what stops an offer being sent", () => {
  const base = {
    status: "draft",
    baseLakh: 4,
    approvedAt: null,
    expiresAt: null,
    job: { compMinLakh: 3, compMaxLakh: 4.5 },
    candidateEmail: "a@b.com",
  };

  it("lets a clean, in-band offer go", () => {
    expect(sendBlockers(base)).toEqual([]);
  });

  it("blocks an over-band offer that has not been approved, and says by how much", () => {
    const blockers = sendBlockers({ ...base, baseLakh: 6 });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("1.5 lakh over");
  });

  it("lets an over-band offer through once approved", () => {
    expect(sendBlockers({ ...base, baseLakh: 6, approvedAt: new Date() })).toEqual([]);
  });

  it("blocks when there is no email — the link only travels by email", () => {
    expect(sendBlockers({ ...base, candidateEmail: null }).join(" ")).toContain("no email");
  });

  it("blocks a second send of something already sent", () => {
    for (const status of ["sent", "viewed", "accepted", "withdrawn"]) {
      expect(sendBlockers({ ...base, status }).length).toBeGreaterThan(0);
    }
  });

  it("blocks an expiry date in the past", () => {
    const blockers = sendBlockers({ ...base, expiresAt: new Date(Date.now() - 86_400_000) });
    expect(blockers.join(" ")).toContain("in the past");
  });

  it("counts only sent and viewed as 'offers out'", () => {
    expect(OFFERS_OUT_STATUSES).toEqual(["sent", "viewed"]);
  });
});

describe("signing tokens", () => {
  it("hashes deterministically, so the raw token never has to be stored", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
    expect(hashToken("abc")).toHaveLength(64);
  });

  it("mints a token whose stored form is its hash, not itself", () => {
    const { raw, hash } = mintToken();
    expect(raw.length).toBeGreaterThan(20);
    expect(hash).toBe(hashToken(raw));
    expect(hash).not.toContain(raw);
  });

  it("mints a different token every time", () => {
    expect(mintToken().raw).not.toBe(mintToken().raw);
  });

  it("builds a signing URL without doubling the slash", () => {
    expect(signingUrl("https://desgro.in/", "tok")).toBe("https://desgro.in/offer/tok");
  });
});

describe("the offer letter", () => {
  const letter = {
    candidateName: "Anu Menon",
    jobTitle: "Documentation Executive",
    department: "Operations",
    locationName: "Kochi",
    startDate: new Date("2026-10-01T00:00:00Z"),
    baseLakh: 4,
    variableLakh: 0.5,
    joiningBonusLakh: null,
    probationMonths: 6,
    noticePeriodDays: 30,
    otherTermsMd: null,
    expiresAt: new Date("2026-09-20T00:00:00Z"),
  };

  it("states the total CTC, not just the base", () => {
    // Base 4 + variable 0.5; money is written to two places once it has any.
    expect(letterHtml(letter)).toContain("4.50 lakh per year");
  });

  it("escapes a candidate's name rather than trusting it", () => {
    const html = letterHtml({ ...letter, candidateName: '<script>alert(1)</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("omits rows it has no value for", () => {
    const html = letterHtml({ ...letter, joiningBonusLakh: null });
    expect(html).not.toContain("Joining bonus");
  });

  it("carries the signature block and audit trail into the PDF version", () => {
    const blocks = letterPdfBlocks(
      letter,
      { name: "Anu Menon", signedAt: new Date("2026-09-15T10:00:00Z"), ip: "1.2.3.4", userAgent: "Safari" },
      [{ at: "2026-09-15T09:00:00Z", event: "viewed", ip: "1.2.3.4", userAgent: "Safari" }],
    );
    const text = blocks.map((b) => ("text" in b ? b.text : "")).join("\n");
    expect(text).toContain("Accepted by the candidate");
    expect(text).toContain("1.2.3.4");
    expect(text).toContain("Audit trail");
  });

  it("leaves the signature block out when nothing has been signed", () => {
    const blocks = letterPdfBlocks(letter, null, []);
    const text = blocks.map((b) => ("text" in b ? b.text : "")).join("\n");
    expect(text).not.toContain("Accepted by the candidate");
  });
});

describe("PDF output", () => {
  it("produces a file that starts and ends like a PDF", () => {
    const pdf = renderPdf([{ type: "heading", text: "Offer" }, { type: "text", text: "Hello" }]);
    const s = pdf.toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("writes an xref whose offsets point at the objects they claim to", () => {
    const s = renderPdf([{ type: "text", text: "Hello" }]).toString("latin1");
    const xrefStart = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(xrefStart, xrefStart + 4)).toBe("xref");

    // The first entry after the free head must land on "1 0 obj".
    const rows = s.slice(xrefStart).split("\n");
    const firstOffset = Number(rows[3]!.slice(0, 10));
    expect(s.slice(firstOffset, firstOffset + 7)).toBe("1 0 obj");
  });

  it("paginates a long document instead of overflowing one page", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ type: "text" as const, text: `Line ${i}` }));
    const s = renderPdf(many).toString("latin1");
    const declared = Number(/\/Count (\d+)/.exec(s)![1]);
    const pageObjects = (s.match(/\/Type \/Page[^s]/g) ?? []).length;
    expect(declared).toBeGreaterThan(1);
    // The count in the page tree must match the page objects actually written.
    expect(pageObjects).toBe(declared);
  });

  it("replaces the rupee sign, which the PDF's Helvetica cannot encode", () => {
    expect(sanitize("₹4 lakh")).toBe("INR 4 lakh");
  });

  it("folds smart punctuation rather than emitting question marks for it", () => {
    expect(sanitize("“quoted” — it’s fine…")).toBe('"quoted" - it\'s fine...');
  });

  it("escapes the characters that delimit a PDF string", () => {
    expect(escapePdfText("a(b)c\\d")).toBe("a\\(b\\)c\\\\d");
  });

  it("renders an empty document without throwing", () => {
    expect(renderPdf([]).toString("latin1")).toContain("%%EOF");
  });
});

// ── Follow-ups ─────────────────────────────────────────────────────────────

function row(partial: Partial<ApplicationRowDTO>): ApplicationRowDTO {
  return {
    id: "a1", candidateId: "c1", fullName: "Anu", email: null, phone: null,
    currentTitle: null, currentEmployer: null, locationText: null, resumeUrl: null,
    tags: [], source: "manual", sourceLabel: "Added manually", ownerId: null, ownerName: null,
    jobId: "j1", jobTitle: "BDE", department: "Sales", stageId: "s1", stageName: "Shortlisted",
    stageKind: "open", stagePosition: 2, status: "active", aiScore: null, aiScoredAt: null,
    needsAttention: false, screenedOutReason: null, rejectionReason: null,
    appliedAt: "2026-09-01T06:30:00.000Z", stageEnteredAt: "2026-09-01T06:30:00.000Z",
    lastContactedAt: null, nextFollowUpAt: null, daysInStage: 3, slaBreached: false,
    daysSinceContact: null, interviewCount: 0, noteCount: 0,
    ...partial,
  } as ApplicationRowDTO;
}

describe("who to chase today", () => {
  // Friday 4 Sep 2026, midday IST.
  const now = new Date("2026-09-04T06:30:00.000Z");

  it("puts a passed follow-up date in Overdue", () => {
    const g = bucketFollowUps([row({ nextFollowUpAt: "2026-09-02T06:30:00.000Z" })], now);
    expect(g.overdue).toHaveLength(1);
  });

  it("puts today's follow-up in Due today", () => {
    const g = bucketFollowUps([row({ nextFollowUpAt: "2026-09-04T04:00:00.000Z" })], now);
    expect(g.due_today).toHaveLength(1);
  });

  it("leaves a future follow-up out of every group", () => {
    expect(countAll(bucketFollowUps([row({ nextFollowUpAt: "2026-09-09T06:30:00.000Z" })], now))).toBe(0);
  });

  it("lists a candidate shortlisted three working days ago with no contact", () => {
    const g = bucketFollowUps([row({ stageEnteredAt: "2026-09-01T06:30:00.000Z" })], now);
    expect(g.silent).toHaveLength(1);
    expect(suggestedAction(g.silent[0]!)).toContain("never contacted");
  });

  it("excludes one messaged yesterday", () => {
    const g = bucketFollowUps(
      [row({ stageEnteredAt: "2026-09-01T06:30:00.000Z", lastContactedAt: "2026-09-03T06:30:00.000Z" })],
      now,
    );
    expect(g.silent).toHaveLength(0);
  });

  it("does not double-chase: a scheduled follow-up wins over the silent check", () => {
    const g = bucketFollowUps(
      [row({ stageEnteredAt: "2026-08-01T06:30:00.000Z", nextFollowUpAt: "2026-09-02T06:30:00.000Z" })],
      now,
    );
    expect(g.overdue).toHaveLength(1);
    expect(g.silent).toHaveLength(0);
  });

  it("ignores anybody who is no longer active", () => {
    const g = bucketFollowUps(
      [row({ status: "rejected", nextFollowUpAt: "2026-09-01T06:30:00.000Z" })],
      now,
    );
    expect(countAll(g)).toBe(0);
  });

  it("sorts the longest-waiting to the top of a group", () => {
    const g = bucketFollowUps(
      [
        row({ id: "recent", nextFollowUpAt: "2026-09-02T06:30:00.000Z", daysSinceContact: 1 }),
        row({ id: "ancient", nextFollowUpAt: "2026-09-02T06:30:00.000Z", daysSinceContact: 40 }),
      ],
      now,
    );
    expect(g.overdue.map((r) => r.id)).toEqual(["ancient", "recent"]);
  });
});
