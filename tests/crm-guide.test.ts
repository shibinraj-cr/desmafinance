import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { MODULES, ROLE_PERMISSIONS } from "@/lib/modules";
import {
  CRM_GUIDE_CHANGES,
  CRM_GUIDE_EXCLUDED,
  GUIDE_GROUPS,
  changesFor,
  crmGuideQuiz,
  crmGuideSections,
  guideCoverage,
  sectionUpdatedOn,
  visibleSections,
  type GuideFacts,
} from "@/lib/crm-guide";

// The seeded CRM (prisma/seed-crm.ts) plus the Long Followup waiting stage.
const FACTS: GuideFacts = {
  stages: [
    { code: "not_yet_started", label: "Not Yet Started", kind: "active", parked: false, pacedByTask: false, isDefault: true, slaDays: 1 },
    { code: "qualify", label: "Qualify", kind: "active", parked: false, pacedByTask: false, isDefault: false, slaDays: 3 },
    { code: "follow_up", label: "Follow-Up", kind: "active", parked: false, pacedByTask: false, isDefault: false, slaDays: 2 },
    { code: "long_followup", label: "Long Followup", kind: "active", parked: false, pacedByTask: true, isDefault: false, slaDays: null },
    { code: "re_marketing", label: "Re-marketing", kind: "active", parked: true, pacedByTask: false, isDefault: false, slaDays: null },
    { code: "centralised_marketing", label: "Centralised Marketing", kind: "active", parked: true, pacedByTask: false, isDefault: false, slaDays: null },
    { code: "pipeline", label: "Pipeline", kind: "active", parked: false, pacedByTask: false, isDefault: false, slaDays: 3 },
    { code: "enrolled", label: "Enrolled", kind: "won", parked: false, pacedByTask: false, isDefault: false, slaDays: null },
    { code: "not_eligible", label: "Not Eligible", kind: "lost", parked: false, pacedByTask: false, isDefault: false, slaDays: null },
    { code: "not_interested", label: "Not Interested", kind: "lost", parked: false, pacedByTask: false, isDefault: false, slaDays: null },
    { code: "duplicate", label: "Duplicate", kind: "lost", parked: false, pacedByTask: false, isDefault: false, slaDays: null },
  ],
  statusGroups: [
    { group: "Not reached", labels: ["Not Contacted", "Not Answering Call"] },
    { group: "Reached", labels: ["Connected On Call"] },
  ],
  defaultStatus: "Not Contacted",
  qualityReasons: ["Wrong / invalid number", "Never reachable"],
  revivedFromLost: ["Not Eligible", "Not Interested"],
  abandonedDays: 30,
  stuckDays: 14,
  firstResponseHours: 24,
  upcomingTaskDays: 30,
  followUpCapDays: 45,
  followUpReviewDays: 40,
  remarketingCapDays: 60,
  followUpCapOn: false,
  remarketingCapOn: false,
  remarketingOn: true,
  remarketingOffsets: [5, 19, 33, 45],
};

const APP_DIR = path.join(__dirname, "..", "src", "app", "(app)");

/** Every page route under /crm on disk, e.g. "/crm/leads/[id]". */
function crmPageRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page.tsx") {
        const rel = path.relative(APP_DIR, dir).split(path.sep).filter((seg) => !/^\(.*\)$/.test(seg));
        out.push("/" + rel.join("/"));
      }
    }
  };
  walk(path.join(APP_DIR, "crm"));
  return out.sort();
}

const sections = crmGuideSections(FACTS);
const covered = guideCoverage(sections);
const isDocumented = (href: string) => covered.has(href) || href in CRM_GUIDE_EXCLUDED;
const crmNav = MODULES.find((m) => m.id === "crm")!.pages.map((p) => p.href);
const crmPermissions = ROLE_PERMISSIONS.map((p) => p.href).filter((h) => h.startsWith("/crm/"));
const pageRoutes = crmPageRoutes();

// When one of these fails you've added (or renamed) something in the CRM:
// teach it in a section of src/lib/crm-guide.ts — or, if BDEs never use it,
// list it in CRM_GUIDE_EXCLUDED with the reason — and add a CRM_GUIDE_CHANGES line.
describe("CRM guide keeps up with the CRM", () => {
  it("finds the CRM pages on disk", () => {
    expect(pageRoutes).toContain("/crm/leads");
    expect(pageRoutes).toContain("/crm/leads/[id]");
  });

  it.each(pageRoutes)("documents the page %s", (href) => {
    expect(isDocumented(href)).toBe(true);
  });

  it.each(crmNav)("documents the sidebar item %s", (href) => {
    expect(isDocumented(href)).toBe(true);
  });

  it.each(crmPermissions)("documents the role permission %s", (href) => {
    expect(isDocumented(href)).toBe(true);
  });

  it("points only at things that still exist", () => {
    const real = new Set([...pageRoutes, ...crmNav, ...crmPermissions]);
    const stale = [...covered, ...Object.keys(CRM_GUIDE_EXCLUDED)].filter((h) => !real.has(h));
    expect(stale).toEqual([]);
  });

  it("never covers and excludes the same href", () => {
    expect(Object.keys(CRM_GUIDE_EXCLUDED).filter((h) => covered.has(h))).toEqual([]);
  });
});

describe("CRM guide content", () => {
  const text = JSON.stringify(sections);

  it("has unique ids, known groups and something to say in every section", () => {
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of sections) {
      expect(GUIDE_GROUPS).toContain(s.group);
      expect(s.blocks.length).toBeGreaterThan(0);
      expect(s.summary.trim()).not.toBe("");
    }
  });

  it("resolves every sidebar label it quotes", () => {
    // nav() falls back to the raw href when a page leaves the sidebar.
    expect(text).not.toMatch(/\*\*\/crm\//);
  });

  it("reads stage names and limits from the CRM, not from its own copy", () => {
    const renamed = crmGuideSections({
      ...FACTS,
      stages: FACTS.stages.map((s) => (s.code === "follow_up" ? { ...s, label: "Chasing", slaDays: 5 } : s)),
      followUpCapDays: 50,
    });
    const t = JSON.stringify(renamed);
    expect(t).toContain("**Chasing**");
    expect(t).not.toContain("Follow-Up");
    expect(t).toContain("Chasing 5 days");
    expect(t).toContain("After 50 days in **Chasing**");
  });

  it("says whether the time limits are on", () => {
    const on = JSON.stringify(crmGuideSections({ ...FACTS, followUpCapOn: true }).find((s) => s.id === "time-limits"));
    expect(on).toContain('"**On**"');
  });

  it("keeps the sidebar table to pages the viewer can open", () => {
    const basics = crmGuideSections(FACTS, (h) => h === "/crm/leads").find((s) => s.id === "basics")!;
    const table = basics.blocks.find((x) => x.kind === "table");
    expect(table?.kind === "table" && table.rows.map((r) => r[0])).toEqual(["**Leads**"]);
  });
});

describe("visibleSections", () => {
  it("shows a plain BDE their pages, not the dashboard or extra permissions", () => {
    const bde = new Set(["/crm/leads", "/crm/tasks", "/crm/my-day", "/crm/inbox", "/crm/report", "/crm/notifications"]);
    const ids = visibleSections(sections, (h) => bde.has(h)).map((s) => s.id);
    expect(ids).toContain("leads-list");
    expect(ids).toContain("alarms");
    expect(ids).not.toContain("dashboard");
    expect(ids).not.toContain("attention");
    expect(ids).not.toContain("extra-permissions");
  });

  it("shows the permissions section to a role holding one", () => {
    const ids = visibleSections(sections, (h) => h === "/crm/notes-all").map((s) => s.id);
    expect(ids).toContain("extra-permissions");
  });
});

describe("CRM_GUIDE_CHANGES", () => {
  const ids = new Set(sections.map((s) => s.id));

  it("names real sections with real dates, newest first", () => {
    for (const c of CRM_GUIDE_CHANGES) {
      expect(ids.has(c.section)).toBe(true);
      expect(c.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(c.date))).toBe(false);
      expect(c.title.trim()).not.toBe("");
    }
    const dates = CRM_GUIDE_CHANGES.map((c) => c.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("filters to the sections in view and dates each section", () => {
    const only = sections.filter((s) => s.id === "quality");
    expect(changesFor(only).every((c) => c.section === "quality")).toBe(true);
    expect(sectionUpdatedOn("quality", CRM_GUIDE_CHANGES)).toBe("2026-10-24");
    expect(sectionUpdatedOn("stages", CRM_GUIDE_CHANGES)).toBeNull();
  });
});

describe("crmGuideQuiz", () => {
  const quiz = crmGuideQuiz(FACTS);

  it("is a well-formed question bank", () => {
    expect(quiz.length).toBeGreaterThanOrEqual(10);
    expect(new Set(quiz.map((q) => q.key)).size).toBe(quiz.length);
    for (const q of quiz) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(new Set(q.options).size).toBe(q.options.length);
      expect(q.correct.length).toBeGreaterThan(0);
      expect(q.correct.every((i) => i >= 0 && i < q.options.length)).toBe(true);
      expect(q.explanation.trim()).not.toBe("");
    }
  });

  it("is stable between calls, so syncing it is a no-op until something changes", () => {
    expect(crmGuideQuiz(FACTS)).toEqual(quiz);
  });

  it("doesn't always put the right answer first", () => {
    expect(quiz.some((q) => q.correct[0] !== 0)).toBe(true);
  });

  it("follows the facts it quotes", () => {
    const renamed = crmGuideQuiz({ ...FACTS, stages: FACTS.stages.map((s) => (s.code === "pipeline" ? { ...s, label: "Deal" } : s)) });
    expect(renamed.find((q) => q.key === "pipeline-how")!.prompt).toContain("Deal");
  });

  it("drops the parked-stage question when no stage is parked", () => {
    const keys = crmGuideQuiz({ ...FACTS, stages: FACTS.stages.map((s) => ({ ...s, parked: false })) }).map((q) => q.key);
    expect(keys).not.toContain("parked");
  });
});
