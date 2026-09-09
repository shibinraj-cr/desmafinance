import { describe, it, expect } from "vitest";
import {
  splitDescription,
  bulletsToMarkdown,
  tabFor,
  groupIntoTabs,
} from "@/lib/hiring/job-sections";

/** The shape of the live Academic Counsellor JD: Word paste, no headings. */
const COUNSELLOR = [
  "Job description: Location: Aroor Company: DESMA International Pvt. Ltd.",
  "About the Company DESMA International Pvt. Ltd. is a leading overseas education consultancy.",
  "About the Role We are looking for a dedicated Student Counsellor.",
  "Key Responsibilities •\tCounsel students regarding study abroad •\tFollow up on leads",
  "Requirements •\tBachelor's degree (any field) •\tMinimum 1-2 years experience",
  "Benefits: •\tCell phone reimbursement •\tPaid sick time",
].join("\n\n");

/** The second live JD — different section names, bullets in their own paragraph. */
const DOCUMENTATION = [
  "₹1.44–2.16 LPA",
  "Company Overview: DESMA International is a leading consultancy.",
  "Position Overview: As a Documentation Executive specializing in AHPRA.",
  "Key Responsibilities",
  "• Document Collection and Verification: Collect and verify all documents. • Liaise with AHPRA.",
  "Qualifications",
  "• Bachelor's degree • Prior experience in healthcare administration",
].join("\n\n");

describe("bulletsToMarkdown", () => {
  it("turns a Word bullet run into real list items", () => {
    expect(bulletsToMarkdown("•\tOne •\tTwo •\tThree")).toBe("- One\n- Two\n- Three");
  });

  it("keeps the text that precedes the first bullet", () => {
    expect(bulletsToMarkdown("You will: •\tOne •\tTwo")).toBe("You will:\n\n- One\n- Two");
  });

  it("leaves ordinary prose alone", () => {
    expect(bulletsToMarkdown("  A normal sentence.  ")).toBe("A normal sentence.");
  });
});

describe("splitDescription", () => {
  it("finds every section in a Word-pasted description", () => {
    const { sections } = splitDescription(COUNSELLOR);
    expect(sections.map((s) => s.title)).toEqual([
      "Job description",
      "About the Company",
      "About the Role",
      "Key Responsibilities",
      "Requirements",
      "Benefits",
    ]);
  });

  it("converts the bullets it finds", () => {
    const { sections } = splitDescription(COUNSELLOR);
    const reqs = sections.find((s) => s.title === "Requirements")!;
    expect(reqs.bodyMd).toContain("- Bachelor's degree (any field)");
    expect(reqs.bodyMd).not.toContain("•");
  });

  /**
   * The rule that matters more than the vocabulary. Word puts a bullet run in
   * its own paragraph; treating each paragraph independently orphaned them, and
   * on this JD that was the difference between 4 sections and 6.
   */
  it("attaches an orphaned bullet paragraph to the section above it", () => {
    const { sections } = splitDescription(DOCUMENTATION);
    const resp = sections.find((s) => s.title === "Key Responsibilities")!;
    expect(resp.bodyMd).toContain("- Document Collection and Verification");
    expect(sections.map((s) => s.title)).toEqual([
      "Company Overview",
      "Position Overview",
      "Key Responsibilities",
      "Qualifications",
    ]);
  });

  it("keeps text that precedes any heading instead of dropping it", () => {
    const { intro } = splitDescription(DOCUMENTATION);
    expect(intro).toBe("₹1.44–2.16 LPA");
  });

  it("prefers the longest matching name", () => {
    const { sections } = splitDescription("About the Company We do things.");
    expect(sections[0]!.title).toBe("About the Company");
  });

  it("returns nothing for an empty description rather than throwing", () => {
    expect(splitDescription(null)).toEqual({ intro: "", sections: [] });
    expect(splitDescription("   ")).toEqual({ intro: "", sections: [] });
  });

  /** A JD with no recognisable headings must fall back, not half-split. */
  it("treats an unrecognisable description as all intro", () => {
    const { intro, sections } = splitDescription("We want someone great.\n\nApply within.");
    expect(sections).toHaveLength(0);
    expect(intro).toContain("We want someone great.");
  });
});

describe("tabs", () => {
  it("folds eight sections into four tabs", () => {
    const { sections } = splitDescription(COUNSELLOR);
    const tabs = groupIntoTabs(sections);
    expect(tabs.map((t) => t.name)).toEqual(["The role", "Responsibilities", "What you need", "More"]);
  });

  it("sends an unknown section to More rather than losing it", () => {
    expect(tabFor("Something Nobody Anticipated")).toBe("More");
    const tabs = groupIntoTabs([{ title: "Wildcard", bodyMd: "x" }]);
    expect(tabs).toEqual([{ name: "More", sections: [{ title: "Wildcard", bodyMd: "x" }] }]);
  });

  it("drops tabs that would render empty", () => {
    const tabs = groupIntoTabs([{ title: "Benefits", bodyMd: "Free tea" }]);
    expect(tabs.map((t) => t.name)).toEqual(["More"]);
  });
});
