/**
 * Turning a pasted job description into sections the careers page can tab.
 *
 * Everything here is pure. It exists because the JDs in this system are pasted
 * out of Word: no markdown headings, and bullets typed as literal "•" followed
 * by a tab, which markdown renders as one long paragraph rather than a list.
 *
 * `descriptionMd` remains the source of truth. Sections are a RENDERING of it —
 * the JobPosting structured data Google reads, the page's meta description and
 * the publish gate all still read the full text, so a job with no sections
 * renders exactly as it does today.
 */

export type JobSection = {
  /** The heading as it will appear on the tab. */
  title: string;
  /** Markdown body, with "•" runs already turned into real list items. */
  bodyMd: string;
};

/**
 * Section names seen in real DESMA job descriptions, plus the obvious synonyms.
 *
 * Matching is by prefix on a paragraph, because that is how these are written:
 * "About the Company DESMA International Pvt. Ltd. is…" — the heading runs
 * straight into its body with no punctuation between them.
 *
 * Longest first, so "About the Company" wins over a hypothetical "About".
 */
const SECTION_NAMES = [
  "Key Responsibilities",
  "Roles and Responsibilities",
  "About the Company",
  "About the Role",
  "Company Overview",
  "Position Overview",
  "Role Overview",
  "Preferred Skills",
  "Responsibilities",
  "Qualifications",
  "Requirements",
  "What We Offer",
  "Job description",
  "Job Description",
  "Experience",
  "Benefits",
  "Skills",
].sort((a, b) => b.length - a.length);

/** Four tabs, because eight is unreadable on a phone. */
export const TAB_ORDER = ["The role", "Responsibilities", "What you need", "More"] as const;
export type TabName = (typeof TAB_ORDER)[number];

const TAB_OF: Record<string, TabName> = {
  "about the company": "The role",
  "company overview": "The role",
  "about the role": "The role",
  "position overview": "The role",
  "role overview": "The role",
  "job description": "The role",
  "key responsibilities": "Responsibilities",
  "roles and responsibilities": "Responsibilities",
  responsibilities: "Responsibilities",
  requirements: "What you need",
  qualifications: "What you need",
  "preferred skills": "What you need",
  skills: "What you need",
  experience: "What you need",
  "what we offer": "More",
  benefits: "More",
};

/** Anything unrecognised lands in "More" rather than vanishing. */
export function tabFor(sectionTitle: string): TabName {
  return TAB_OF[sectionTitle.trim().toLowerCase()] ?? "More";
}

/**
 * "• Do a thing • Do another" → real markdown list items.
 *
 * Word bullets arrive as "•" plus a tab or spaces, all on one line. Left alone
 * markdown treats the whole run as a single paragraph, which is why the live
 * pages have 42 bullets and zero <ul>.
 */
export function bulletsToMarkdown(text: string): string {
  if (!text.includes("•")) return text.trim();

  const [lead, ...rest] = text.split("•");
  const items = rest.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!items.length) return text.trim();

  const head = lead.replace(/\s+/g, " ").trim();
  const list = items.map((i) => `- ${i}`).join("\n");
  return head ? `${head}\n\n${list}` : list;
}

/** The section name a paragraph opens with, or null. */
function nameAt(paragraph: string): string | null {
  const p = paragraph.trimStart().toLowerCase();
  return SECTION_NAMES.find((n) => p.startsWith(n.toLowerCase())) ?? null;
}

/**
 * Split a pasted description into sections.
 *
 * The rule that does the real work is not the vocabulary — it is that a
 * paragraph naming no section CONTINUES the one before it. Word splits a bullet
 * run across its own paragraphs, and treating each independently orphaned them:
 * on the second live job that was the difference between 4 sections and 6.
 *
 * Text before any recognised heading is returned as `intro`, so a salary line
 * or a one-line summary is never silently dropped.
 */
export function splitDescription(descriptionMd: string | null | undefined): {
  intro: string;
  sections: JobSection[];
} {
  const text = (descriptionMd ?? "").trim();
  if (!text) return { intro: "", sections: [] };

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const sections: JobSection[] = [];
  const introParts: string[] = [];

  for (const p of paragraphs) {
    const name = nameAt(p);
    if (name) {
      sections.push({
        title: name,
        bodyMd: bulletsToMarkdown(p.slice(name.length).replace(/^[\s:–—-]+/, "")),
      });
    } else if (sections.length) {
      const last = sections[sections.length - 1]!;
      const add = bulletsToMarkdown(p);
      last.bodyMd = last.bodyMd ? `${last.bodyMd}\n\n${add}` : add;
    } else {
      introParts.push(p);
    }
  }

  return {
    intro: introParts.join("\n\n"),
    sections: sections.filter((s) => s.bodyMd.trim().length > 0),
  };
}

/** Group sections into the four tabs, dropping tabs that end up empty. */
export function groupIntoTabs(sections: JobSection[]): { name: TabName; sections: JobSection[] }[] {
  return TAB_ORDER.map((name) => ({
    name,
    sections: sections.filter((s) => tabFor(s.title) === name),
  })).filter((t) => t.sections.length > 0);
}
