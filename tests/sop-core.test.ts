import { describe, expect, it } from "vitest";
import {
  deriveDeptCode,
  formatSopNumber,
  formatSla,
  isSopStatus,
  slaToMinutes,
  sopStatusLabel,
} from "@/lib/sop/constants";
import {
  compareVersionsDesc,
  initialVersion,
  latestVersion,
  nextFreeVersion,
  nextVersion,
  parseVersionLabel,
  versionLabel,
} from "@/lib/sop/versioning";
import {
  addDays,
  addMonths,
  computeNextReviewDate,
  daysBetween,
  isAckOverdue,
  reviewBucket,
  reviewDueLabel,
  utcDate,
} from "@/lib/sop/review-dates";
import { parseSopRichText, parseSopInline, safeHref, sopRichTextToPlain } from "@/lib/sop/richtext";
import { acknowledgementState, summariseAcknowledgements } from "@/lib/sop/acknowledge";
import { availableActions, canTransition, isEditableStatus } from "@/lib/sop/workflow";

describe("SOP numbering", () => {
  it("uses the known abbreviation for the departments that have one", () => {
    expect(deriveDeptCode("Operations")).toBe("OPS");
    expect(deriveDeptCode("operations")).toBe("OPS");
    expect(deriveDeptCode("Human Resources")).toBe("HR");
    expect(deriveDeptCode("Finance")).toBe("FIN");
    expect(deriveDeptCode("Marketing")).toBe("MKT");
  });

  it("uses the obvious prefix for the department names this install actually has", () => {
    // Without the override these mint HA / FA / MS, which is correct by the
    // initials rule and wrong by every other measure.
    expect(deriveDeptCode("HR & Administration")).toBe("HR");
    expect(deriveDeptCode("Finance & Accounting")).toBe("FIN");
    expect(deriveDeptCode("Marketing Services")).toBe("MKT");
    // The ones with no override still derive sensibly.
    expect(deriveDeptCode("Candidate Support & Guidance")).toBe("CSG");
    expect(deriveDeptCode("Lead Filtering & Qualification")).toBe("LFQ");
    expect(deriveDeptCode("Management")).toBe("MGT");
    expect(deriveDeptCode("Sales")).toBe("SLS");
  });

  it("makes initials from a multi-word name and drops connectives", () => {
    expect(deriveDeptCode("Learning and Development")).toBe("LD");
    expect(deriveDeptCode("Client Relations Department")).toBe("CR");
  });

  it("takes the first three letters of a single-word name", () => {
    expect(deriveDeptCode("Legal")).toBe("LEG");
  });

  it("falls back to GEN when there is no usable name", () => {
    expect(deriveDeptCode(null)).toBe("GEN");
    expect(deriveDeptCode("")).toBe("GEN");
    expect(deriveDeptCode("   ")).toBe("GEN");
    expect(deriveDeptCode("!!!")).toBe("GEN");
  });

  it("formats the number with a three-digit sequence that widens past 999", () => {
    expect(formatSopNumber("OPS", 1)).toBe("OPS-SOP-001");
    expect(formatSopNumber("HR", 4)).toBe("HR-SOP-004");
    expect(formatSopNumber("FIN", 9)).toBe("FIN-SOP-009");
    expect(formatSopNumber("MKT", 123)).toBe("MKT-SOP-123");
    expect(formatSopNumber("OPS", 1000)).toBe("OPS-SOP-1000");
  });

  it("is deterministic — the same name always mints the same code", () => {
    const names = ["Operations", "Quality", "Learning and Development", "Legal"];
    for (const n of names) expect(deriveDeptCode(n)).toBe(deriveDeptCode(n));
  });
});

describe("SLA", () => {
  it("converts value + unit to a comparable minute count", () => {
    expect(slaToMinutes(4, "hours")).toBe(240);
    expect(slaToMinutes(1, "days")).toBe(1440);
    expect(slaToMinutes(30, "minutes")).toBe(30);
  });

  it("returns null for a half-set or invalid SLA", () => {
    expect(slaToMinutes(null, "hours")).toBeNull();
    expect(slaToMinutes(4, null)).toBeNull();
    expect(slaToMinutes(4, "fortnights")).toBeNull();
    expect(slaToMinutes(-1, "hours")).toBeNull();
  });

  it("reads back the way it was written, singularising 1", () => {
    expect(formatSla(4, "hours")).toBe("4 hours");
    expect(formatSla(1, "days")).toBe("1 day");
    expect(formatSla(1, "hours")).toBe("1 hour");
    expect(formatSla(null, "hours")).toBe("—");
  });
});

describe("version numbering", () => {
  it("starts at V1.0", () => {
    expect(versionLabel(initialVersion())).toBe("V1.0");
  });

  it("bumps minor and major as the brief describes", () => {
    expect(versionLabel(nextVersion({ major: 1, minor: 0 }, "minor"))).toBe("V1.1");
    expect(versionLabel(nextVersion({ major: 1, minor: 2 }, "minor"))).toBe("V1.3");
    expect(versionLabel(nextVersion({ major: 1, minor: 2 }, "major"))).toBe("V2.0");
  });

  it("skips a label that a discarded draft already spent", () => {
    const next = nextFreeVersion({ major: 1, minor: 0 }, "minor", ["V1.0", "V1.1", "V1.2"]);
    expect(versionLabel(next)).toBe("V1.3");
  });

  it("finds the highest version, not the last one added", () => {
    const v = latestVersion([
      { major: 1, minor: 0 },
      { major: 2, minor: 1 },
      { major: 1, minor: 9 },
    ]);
    expect(versionLabel(v)).toBe("V2.1");
  });

  it("sorts newest first", () => {
    const sorted = [
      { major: 1, minor: 0 },
      { major: 2, minor: 0 },
      { major: 1, minor: 5 },
    ].sort(compareVersionsDesc);
    expect(sorted.map(versionLabel)).toEqual(["V2.0", "V1.5", "V1.0"]);
  });

  it("round-trips a label", () => {
    expect(parseVersionLabel("V2.1")).toEqual({ major: 2, minor: 1 });
    expect(parseVersionLabel("2.1")).toEqual({ major: 2, minor: 1 });
    expect(parseVersionLabel("draft")).toBeNull();
  });
});

describe("review dates", () => {
  const from = utcDate(2026, 1, 31);

  it("adds months clamped to the end of the target month", () => {
    // 31 Jan + 1 month is 28 Feb, not 3 March.
    expect(addMonths(from, 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(addMonths(utcDate(2024, 1, 31), 1).toISOString().slice(0, 10)).toBe("2024-02-29");
    expect(addMonths(utcDate(2026, 3, 15), 3).toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  it("computes the next review from the frequency", () => {
    const base = utcDate(2026, 6, 10);
    expect(computeNextReviewDate(base, "weekly")?.toISOString().slice(0, 10)).toBe("2026-06-17");
    expect(computeNextReviewDate(base, "monthly")?.toISOString().slice(0, 10)).toBe("2026-07-10");
    expect(computeNextReviewDate(base, "quarterly")?.toISOString().slice(0, 10)).toBe("2026-09-10");
    expect(computeNextReviewDate(base, "half_yearly")?.toISOString().slice(0, 10)).toBe("2026-12-10");
    expect(computeNextReviewDate(base, "yearly")?.toISOString().slice(0, 10)).toBe("2027-06-10");
    expect(computeNextReviewDate(base, "custom", 45)?.toISOString().slice(0, 10)).toBe("2026-07-25");
  });

  it("returns null when the frequency carries no interval", () => {
    const base = utcDate(2026, 6, 10);
    expect(computeNextReviewDate(base, null)).toBeNull();
    expect(computeNextReviewDate(base, "custom")).toBeNull();
    expect(computeNextReviewDate(base, "custom", 0)).toBeNull();
    expect(computeNextReviewDate(base, "whenever")).toBeNull();
  });

  it("buckets a review date against the SOP's own reminder window", () => {
    // Fixed "now" so the test does not drift. 10:00 UTC is the same IST day.
    const now = new Date("2026-06-10T10:00:00Z");
    expect(reviewBucket(utcDate(2026, 6, 1), 15, now)).toBe("overdue");
    expect(reviewBucket(utcDate(2026, 6, 10), 15, now)).toBe("due_today");
    expect(reviewBucket(utcDate(2026, 6, 20), 15, now)).toBe("due_soon");
    expect(reviewBucket(utcDate(2026, 8, 1), 15, now)).toBe("scheduled");
    // A 7-day window makes the same date "scheduled" rather than "due soon".
    expect(reviewBucket(utcDate(2026, 6, 20), 7, now)).toBe("scheduled");
    expect(reviewBucket(null, 15, now)).toBe("none");
  });

  it("uses the IST calendar day, not the UTC one", () => {
    // 2026-06-09 23:00 UTC is already the 10th in India, so a review due on
    // the 10th must read as due today, not tomorrow.
    const lateUtc = new Date("2026-06-09T23:00:00Z");
    expect(reviewBucket(utcDate(2026, 6, 10), 15, lateUtc)).toBe("due_today");
  });

  it("labels the distance in plain words", () => {
    const now = new Date("2026-06-10T10:00:00Z");
    expect(reviewDueLabel(utcDate(2026, 6, 10), now)).toBe("today");
    expect(reviewDueLabel(utcDate(2026, 6, 11), now)).toBe("in 1 day");
    expect(reviewDueLabel(utcDate(2026, 6, 22), now)).toBe("in 12 days");
    expect(reviewDueLabel(utcDate(2026, 6, 4), now)).toBe("6 days overdue");
    expect(reviewDueLabel(null, now)).toBe("—");
  });

  it("counts whole days in both directions", () => {
    expect(daysBetween(utcDate(2026, 6, 1), utcDate(2026, 6, 11))).toBe(10);
    expect(daysBetween(utcDate(2026, 6, 11), utcDate(2026, 6, 1))).toBe(-10);
    expect(addDays(utcDate(2026, 6, 1), 10).toISOString().slice(0, 10)).toBe("2026-06-11");
  });
});

describe("rich text", () => {
  it("parses the markdown subset into blocks", () => {
    const blocks = parseSopRichText("## Heading\n\nA paragraph.\n\n- one\n- two\n\n1. first\n2. second");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list"]);
    const bullets = blocks[2];
    expect(bullets.type === "list" && bullets.ordered).toBe(false);
    const numbered = blocks[3];
    expect(numbered.type === "list" && numbered.ordered).toBe(true);
  });

  it("parses bold, italic, code and links inline", () => {
    const tokens = parseSopInline("**bold** and *italic* and `code` and [a link](https://example.com)");
    expect(tokens.map((t) => t.type)).toContain("bold");
    expect(tokens.map((t) => t.type)).toContain("italic");
    expect(tokens.map((t) => t.type)).toContain("code");
    const link = tokens.find((t) => t.type === "link");
    expect(link && "href" in link && link.href).toBe("https://example.com");
  });

  it("refuses a hostile href and degrades the link to plain text", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHref("vbscript:msgbox")).toBeNull();
    expect(safeHref("//evil.example/path")).toBeNull();
    expect(safeHref("https://example.com/x")).toBe("https://example.com/x");
    expect(safeHref("mailto:someone@example.com")).toBe("mailto:someone@example.com");
    expect(safeHref("/sop/library")).toBe("/sop/library");

    const tokens = parseSopInline("[click me](javascript:alert(1))");
    expect(tokens.every((t) => t.type !== "link")).toBe(true);
  });

  it("never produces markup from authored text", () => {
    const blocks = parseSopRichText("<script>alert(1)</script> and <b>bold</b>");
    const text = JSON.stringify(blocks);
    // The angle brackets survive as literal characters in a `text` token —
    // they are never turned into an element.
    expect(text).toContain("script");
    expect(blocks.every((b) => b.type === "paragraph")).toBe(true);
  });

  it("flattens to plain text for previews", () => {
    expect(sopRichTextToPlain("## Title\n\nSome **bold** copy.")).toBe("Title Some bold copy.");
    expect(sopRichTextToPlain(null)).toBe("");
    expect(sopRichTextToPlain("a".repeat(500), 20).endsWith("…")).toBe(true);
  });
});

describe("workflow transitions", () => {
  it("allows only the moves the lifecycle defines", () => {
    expect(canTransition("draft", "request_review")).toBe("review_requested");
    expect(canTransition("changes_requested", "request_review")).toBe("review_requested");
    expect(canTransition("review_requested", "approve_review")).toBe("approval_pending");
    expect(canTransition("approval_pending", "approve")).toBe("approved");
    expect(canTransition("approved", "publish")).toBe("published");
  });

  it("refuses the moves that would skip a gate", () => {
    // Straight from draft to published, or approving something nobody reviewed.
    expect(canTransition("draft", "publish")).toBeNull();
    expect(canTransition("draft", "approve")).toBeNull();
    expect(canTransition("review_requested", "publish")).toBeNull();
    expect(canTransition("approval_pending", "approve_review")).toBeNull();
  });

  it("refuses every move out of published — a published version is history", () => {
    for (const action of ["request_review", "approve_review", "approve", "publish", "request_changes"] as const) {
      expect(canTransition("published", action)).toBeNull();
    }
  });

  it("sends back from either gate", () => {
    expect(canTransition("review_requested", "request_changes")).toBe("changes_requested");
    expect(canTransition("approval_pending", "request_changes")).toBe("changes_requested");
    expect(canTransition("draft", "request_changes")).toBeNull();
  });

  it("lists the actions legal from a status", () => {
    expect(availableActions("draft").sort()).toEqual(["request_review", "submit_for_approval"]);
    expect(availableActions("approved")).toEqual(["publish"]);
    expect(availableActions("published")).toEqual([]);
  });

  it("treats only the author-held statuses as editable", () => {
    expect(isEditableStatus("draft")).toBe(true);
    expect(isEditableStatus("changes_requested")).toBe(true);
    expect(isEditableStatus("revision_required")).toBe(true);
    expect(isEditableStatus("review_requested")).toBe(false);
    expect(isEditableStatus("approval_pending")).toBe(false);
    expect(isEditableStatus("approved")).toBe(false);
    expect(isEditableStatus("published")).toBe(false);
    expect(isEditableStatus("archived")).toBe(false);
  });

  it("recognises every status the module writes", () => {
    for (const s of [
      "draft",
      "review_requested",
      "changes_requested",
      "approval_pending",
      "approved",
      "published",
      "revision_required",
      "archived",
    ]) {
      expect(isSopStatus(s)).toBe(true);
      expect(sopStatusLabel(s)).not.toBe(s);
    }
    expect(isSopStatus("nonsense")).toBe(false);
  });
});

describe("acknowledgement state", () => {
  const now = new Date("2026-06-10T10:00:00Z");
  const past = utcDate(2026, 6, 1);
  const future = utcDate(2026, 6, 30);

  it("is acknowledged once confirmed, whatever the deadline", () => {
    expect(
      acknowledgementState({ deadline: past, viewedAt: null, acknowledgedAt: new Date() }, now),
    ).toBe("acknowledged");
  });

  it("is overdue when the deadline has passed and it is not confirmed", () => {
    expect(acknowledgementState({ deadline: past, viewedAt: null, acknowledgedAt: null }, now)).toBe(
      "overdue",
    );
    // Overdue outranks viewed — that is the case the dashboard exists to show.
    expect(acknowledgementState({ deadline: past, viewedAt: new Date(), acknowledgedAt: null }, now)).toBe(
      "overdue",
    );
  });

  it("is viewed or not-viewed while still in time", () => {
    expect(acknowledgementState({ deadline: future, viewedAt: new Date(), acknowledgedAt: null }, now)).toBe(
      "viewed",
    );
    expect(acknowledgementState({ deadline: future, viewedAt: null, acknowledgedAt: null }, now)).toBe(
      "not_viewed",
    );
  });

  it("is never overdue without a deadline", () => {
    expect(isAckOverdue(null, null, now)).toBe(false);
    expect(acknowledgementState({ deadline: null, viewedAt: null, acknowledgedAt: null }, now)).toBe(
      "not_viewed",
    );
  });

  it("summarises the register the way the dashboard reads it", () => {
    const rows = [
      { deadline: future, viewedAt: new Date(), acknowledgedAt: new Date() }, // acknowledged
      { deadline: future, viewedAt: new Date(), acknowledgedAt: null }, // viewed, pending
      { deadline: future, viewedAt: null, acknowledgedAt: null }, // not viewed, pending
      { deadline: past, viewedAt: null, acknowledgedAt: null }, // overdue, pending
    ];
    const s = summariseAcknowledgements(rows, now);
    expect(s.total).toBe(4);
    expect(s.acknowledged).toBe(1);
    // Viewed counts everyone who opened it, acknowledged ones included.
    expect(s.viewed).toBe(2);
    // Pending is everyone not acknowledged; overdue is a subset of it.
    expect(s.pending).toBe(3);
    expect(s.overdue).toBe(1);
  });

  it("summarises an empty register without dividing by anything", () => {
    expect(summariseAcknowledgements([], now)).toEqual({
      total: 0,
      viewed: 0,
      acknowledged: 0,
      pending: 0,
      overdue: 0,
    });
  });
});
