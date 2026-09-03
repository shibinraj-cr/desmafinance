import { describe, it, expect } from "vitest";
import {
  slugify,
  uniqueSlug,
  normalizeEmail,
  normalizeCandidatePhone,
  compBandLabel,
  totalCtcLakh,
  daysOpen,
  isAging,
  workingDaysBetween,
  isSilentShortlist,
  rubricWeightsValid,
  validateJobForPublish,
  missingMustHaves,
  formatHiringDate,
} from "@/lib/hiring/core";

/** An IST instant for a YYYY-MM-DD calendar day (midday, so no TZ edge). */
function ist(day: string): Date {
  return new Date(`${day}T06:30:00.000Z`); // 12:00 IST
}

describe("slugs", () => {
  it("turns a job title into a careers-page segment", () => {
    expect(slugify("Business Development Executive")).toBe("business-development-executive");
    expect(slugify("Sr. Counsellor (Kochi) — Nursing")).toBe("sr-counsellor-kochi-nursing");
  });

  it("strips accents rather than dropping the word", () => {
    expect(slugify("Résumé Screener")).toBe("resume-screener");
  });

  it("never returns a leading or trailing dash", () => {
    expect(slugify("  --Ops Exec--  ")).toBe("ops-exec");
  });

  it("suffixes a slug that is already taken", () => {
    expect(uniqueSlug("BDE", [])).toBe("bde");
    expect(uniqueSlug("BDE", ["bde"])).toBe("bde-2");
    expect(uniqueSlug("BDE", ["bde", "bde-2"])).toBe("bde-3");
  });

  it("falls back to a usable slug when the title has no letters", () => {
    expect(uniqueSlug("###", [])).toBe("role");
  });
});

describe("candidate dedupe keys", () => {
  it("lower-cases email, since this Postgres has no citext", () => {
    expect(normalizeEmail("  Anu.K@Example.COM ")).toBe("anu.k@example.com");
  });

  it("returns null for an unusable address rather than storing junk", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it("reads a bare Indian mobile as +91 (a typed number means the local one)", () => {
    expect(normalizeCandidatePhone("9847012345")).toBe("+919847012345");
    expect(normalizeCandidatePhone("+91 98470 12345")).toBe("+919847012345");
  });
});

describe("comp, in lakh per year", () => {
  it("labels a band", () => {
    expect(compBandLabel(4, 6)).toBe("₹4–6 LPA");
    expect(compBandLabel(4.5, 6.25)).toBe("₹4.50–6.25 LPA");
  });

  it("labels an open-ended band", () => {
    expect(compBandLabel(4, null)).toBe("₹4+ LPA");
    expect(compBandLabel(null, 6)).toBe("up to ₹6 LPA");
  });

  it("says nothing when there is no band", () => {
    expect(compBandLabel(null, null)).toBeNull();
  });

  it("totals an offer", () => {
    expect(totalCtcLakh({ baseLakh: 4.5, variableLakh: 0.5, joiningBonusLakh: 0.25 })).toBe(5.25);
    expect(totalCtcLakh({ baseLakh: 6 })).toBe(6);
  });
});

describe("requisition aging", () => {
  const published = ist("2026-08-01");

  it("counts days from publish", () => {
    expect(daysOpen({ publishedAt: published, closedAt: ist("2026-08-11") })).toBe(10);
  });

  it("stops the clock when the req closes", () => {
    const closed = { publishedAt: published, closedAt: ist("2026-08-05") };
    expect(daysOpen(closed)).toBe(4);
  });

  it("has no age before publish", () => {
    expect(daysOpen({ publishedAt: null, closedAt: null })).toBeNull();
  });

  it("flags a live req open more than 21 days", () => {
    const job = { status: "live", publishedAt: ist("2026-08-01"), closedAt: null };
    expect(isAging({ ...job, closedAt: ist("2026-08-22") })).toBe(false); // exactly 21
    expect(isAging({ ...job, closedAt: ist("2026-08-23") })).toBe(true); // 22
  });

  it("never flags a draft, paused or closed req", () => {
    for (const status of ["draft", "paused", "closed", "pending_approval"]) {
      expect(isAging({ status, publishedAt: ist("2026-01-01"), closedAt: null })).toBe(false);
    }
  });
});

describe("working days — Mon–Sat, Sunday off", () => {
  it("counts a plain run of weekdays", () => {
    // Tue 01 → Fri 04
    expect(workingDaysBetween("2026-09-01", "2026-09-04")).toBe(3);
  });

  it("skips the Sunday in between", () => {
    // Fri 04 → Tue 08 spans Sat, Sun, Mon, Tue = 4 days, minus Sunday = 3
    expect(workingDaysBetween("2026-09-04", "2026-09-08")).toBe(3);
  });

  it("counts Saturday as a working day", () => {
    // Fri 04 → Sat 05
    expect(workingDaysBetween("2026-09-04", "2026-09-05")).toBe(1);
  });

  it("is zero for the same day or a backwards range", () => {
    expect(workingDaysBetween("2026-09-04", "2026-09-04")).toBe(0);
    expect(workingDaysBetween("2026-09-08", "2026-09-01")).toBe(0);
  });
});

describe("shortlisted but silent (§3.4 / acceptance check 9)", () => {
  const now = ist("2026-09-04"); // Friday
  const base = { stageKind: "open", stageName: "Shortlisted" };

  it("lists one shortlisted three working days ago with no outbound contact", () => {
    expect(
      isSilentShortlist({ ...base, stageEnteredAt: ist("2026-09-01"), lastContactedAt: null }, now),
    ).toBe(true);
  });

  it("excludes one messaged yesterday", () => {
    expect(
      isSilentShortlist(
        { ...base, stageEnteredAt: ist("2026-09-01"), lastContactedAt: ist("2026-09-03") },
        now,
      ),
    ).toBe(false);
  });

  it("does not call it silent on day two", () => {
    expect(
      isSilentShortlist({ ...base, stageEnteredAt: ist("2026-09-02"), lastContactedAt: null }, now),
    ).toBe(false);
  });

  it("ignores a Sunday when deciding — Mon shortlist is not silent by Wednesday", () => {
    // Mon 07 → Wed 09 is 2 working days, still inside the window.
    expect(
      isSilentShortlist(
        { ...base, stageEnteredAt: ist("2026-09-07"), lastContactedAt: null },
        ist("2026-09-09"),
      ),
    ).toBe(false);
  });

  it("only applies to a shortlisted stage", () => {
    expect(
      isSilentShortlist(
        { stageKind: "open", stageName: "Applied", stageEnteredAt: ist("2026-08-01"), lastContactedAt: null },
        now,
      ),
    ).toBe(false);
  });

  it("never chases a terminal stage", () => {
    expect(
      isSilentShortlist(
        { stageKind: "lost", stageName: "Shortlisted", stageEnteredAt: ist("2026-08-01"), lastContactedAt: null },
        now,
      ),
    ).toBe(false);
  });
});

describe("publish readiness", () => {
  const ok = {
    title: "BDE",
    descriptionMd: "Sell things.",
    mustHaves: ["2 years sales"],
    rubrics: [{ weight: 40 }, { weight: 25 }, { weight: 20 }, { weight: 15 }],
  };

  it("passes a complete req", () => {
    expect(validateJobForPublish(ok)).toEqual({ ready: true, blockers: [] });
  });

  it("blocks a req with no description", () => {
    const r = validateJobForPublish({ ...ok, descriptionMd: null });
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toContain("description");
  });

  it("blocks a req with no must-haves", () => {
    const r = validateJobForPublish({ ...ok, mustHaves: [] });
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toContain("must-have");
  });

  it("blocks rubric weights that do not total 100 and says the total", () => {
    const r = validateJobForPublish({ ...ok, rubrics: [{ weight: 40 }, { weight: 40 }] });
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toContain("80%");
  });

  it("rejects an empty rubric", () => {
    expect(rubricWeightsValid([])).toBe(false);
    expect(rubricWeightsValid([{ weight: 100 }])).toBe(true);
  });
});

describe("must-have screening is a flag, not a verdict", () => {
  it("names the must-haves the application gives no evidence for", () => {
    const missing = missingMustHaves(
      ["Malayalam", "2 years sales", "Own vehicle"],
      "I have three years of sales experience and speak Malayalam fluently.",
    );
    expect(missing).toEqual(["2 years sales", "Own vehicle"]);
  });

  it("matches case-insensitively", () => {
    expect(missingMustHaves(["MALAYALAM"], "malayalam speaker")).toEqual([]);
  });

  it("returns nothing when the job has no must-haves", () => {
    expect(missingMustHaves([], "anything")).toEqual([]);
  });
});

describe("dates render IST", () => {
  it("formats dd MMM yyyy", () => {
    expect(formatHiringDate(ist("2026-09-04"))).toBe("04 Sep 2026");
  });

  it("shows an em dash rather than 'Invalid Date'", () => {
    expect(formatHiringDate(null)).toBe("—");
    expect(formatHiringDate("nonsense")).toBe("—");
  });

  it("uses the IST calendar day, not UTC", () => {
    // 20:00 UTC on 3 Sep is 01:30 IST on 4 Sep.
    expect(formatHiringDate(new Date("2026-09-03T20:00:00.000Z"))).toBe("04 Sep 2026");
  });
});
