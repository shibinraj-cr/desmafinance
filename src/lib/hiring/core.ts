/**
 * Pure hiring helpers — no DB, no React. Everything here is unit-tested in
 * tests/hiring-core.test.ts.
 */
import { normalizePhone } from "@/lib/crm";
import { istDateString, todayIst, addDays } from "@/lib/lead-pulse-dates";
import { JOB_AGING_DAYS, SILENT_SHORTLIST_WORKING_DAYS } from "./constants";

/** Careers-page URL segment for a job title. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Make `base` unique against slugs already taken, by appending -2, -3, …
 * Deterministic, so a retry of the same publish lands on the same slug.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slugify(base) || "role";
  if (!used.has(root)) return root;
  for (let n = 2; n < 500; n++) {
    const candidate = `${root}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}

/**
 * Dedupe key for a candidate's email. Stored lower-cased because this Postgres
 * has no `citext`, so case-insensitive uniqueness has to be an app invariant —
 * every write path goes through here.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  // Deliberately permissive: a careers-page applicant typing a odd-but-valid
  // address should not be rejected by our regex. This only rejects the clearly
  // unusable.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}

/** Dedupe key for a candidate's phone: E.164, +91 assumed for a bare number. */
export function normalizeCandidatePhone(raw: string | null | undefined): string | null {
  return normalizePhone(raw);
}

/** "4.5" -> "4.50 LPA"; a band -> "4.50 – 6.00 LPA"; nothing -> null. */
export function compBandLabel(
  min: number | null | undefined,
  max: number | null | undefined,
): string | null {
  const lo = min ?? null;
  const hi = max ?? null;
  if (lo == null && hi == null) return null;
  const f = (n: number) => n.toFixed(2).replace(/\.00$/, "");
  if (lo != null && hi != null) return `₹${f(lo)}–${f(hi)} LPA`;
  if (lo != null) return `₹${f(lo)}+ LPA`;
  return `up to ₹${f(hi as number)} LPA`;
}

/** Total CTC for the offer simulator, in lakh/year. */
export function totalCtcLakh(parts: {
  baseLakh: number;
  variableLakh?: number | null;
  joiningBonusLakh?: number | null;
}): number {
  return (
    round2(parts.baseLakh) + round2(parts.variableLakh ?? 0) + round2(parts.joiningBonusLakh ?? 0)
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Whole days between two instants, floored. Never negative. */
export function daysBetween(from: Date, to: Date = new Date()): number {
  const ms = to.getTime() - from.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

/** How long a live req has been open. Closed reqs stop the clock. */
export function daysOpen(job: { publishedAt: Date | null; closedAt: Date | null }): number | null {
  if (!job.publishedAt) return null;
  return daysBetween(job.publishedAt, job.closedAt ?? new Date());
}

/** §3.1: a LIVE req open longer than 21 days. */
export function isAging(job: {
  status: string;
  publishedAt: Date | null;
  closedAt: Date | null;
}): boolean {
  if (job.status !== "live") return false;
  const d = daysOpen(job);
  return d != null && d > JOB_AGING_DAYS;
}

/**
 * Working days between two IST dates, EXCLUDING Sundays — the company works
 * Mon–Sat. Counts whole elapsed days, so same-day is 0.
 */
export function workingDaysBetween(fromIso: string, toIso: string = todayIst()): number {
  if (fromIso >= toIso) return 0;
  let count = 0;
  let cursor = fromIso;
  while (cursor < toIso) {
    cursor = addDays(cursor, 1);
    if (dayOfWeekIso(cursor) !== 0) count++; // 0 = Sunday
  }
  return count;
}

/** Day of week for a YYYY-MM-DD string, 0=Sunday … 6=Saturday. */
export function dayOfWeekIso(yyyyMmDd: string): number {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * §3.4 "Shortlisted but silent": in a shortlisted stage, and no outbound
 * contact for MORE than two working days. A candidate messaged yesterday is
 * never silent; one shortlisted three working days ago with no contact is.
 */
export function isSilentShortlist(
  app: { stageKind: string; stageName: string; stageEnteredAt: Date; lastContactedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (app.stageKind !== "open") return false;
  if (!/short ?list/i.test(app.stageName)) return false;
  // The clock runs from the last outbound contact, or from entering the stage
  // when nobody has ever reached out.
  const since = app.lastContactedAt ?? app.stageEnteredAt;
  const days = workingDaysBetween(istDateString(since), istDateString(now));
  return days > SILENT_SHORTLIST_WORKING_DAYS;
}

/** Rubric weights must total exactly 100 before a job may be published. */
export function rubricWeightsValid(rubrics: { weight: number }[]): boolean {
  if (rubrics.length === 0) return false;
  return rubrics.reduce((s, r) => s + r.weight, 0) === 100;
}

export type JobReadiness = {
  ready: boolean;
  /** Human-readable reasons a job cannot go live yet. */
  blockers: string[];
};

/**
 * What stops a req going live. A job missing a description or must-haves saves
 * as a DRAFT and says so — it is never silently published.
 */
export function validateJobForPublish(job: {
  title: string;
  descriptionMd: string | null;
  mustHaves: string[];
  rubrics: { weight: number }[];
}): JobReadiness {
  const blockers: string[] = [];
  if (!job.title.trim()) blockers.push("The job needs a title.");
  if (!job.descriptionMd?.trim()) blockers.push("The job needs a description.");
  if (job.mustHaves.length === 0)
    blockers.push("Add at least one must-have — they are what screening reads.");
  if (!rubricWeightsValid(job.rubrics)) {
    const total = job.rubrics.reduce((s, r) => s + r.weight, 0);
    blockers.push(
      job.rubrics.length === 0
        ? "The scoring rubric is empty."
        : `Rubric weights total ${total}%, and must total 100%.`,
    );
  }
  return { ready: blockers.length === 0, blockers };
}

/**
 * Which must-haves the application gives no evidence for. This is a FLAG for a
 * human to confirm — never an auto-rejection (§4.4). Matching is deliberately
 * literal (case-insensitive substring over the candidate's own words): a
 * cleverer matcher that silently decides is worse than an obvious one a
 * recruiter can overrule.
 */
export function missingMustHaves(mustHaves: string[], haystack: string): string[] {
  const hay = haystack.toLowerCase();
  return mustHaves.filter((m) => {
    const needle = m.trim().toLowerCase();
    if (!needle) return false;
    return !hay.includes(needle);
  });
}

/**
 * The module's one date rendering: `dd MMM yyyy` in IST.
 *
 * Built from explicit parts rather than a locale pattern on purpose — Node's
 * `en-GB` renders September as "Sept", and the abbreviation set has changed
 * between ICU versions, so a locale string here would render differently on a
 * developer's machine and on Vercel.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The IST calendar parts of an instant, so 01:30 IST is the NEXT day, not today. */
function istParts(date: Date): { day: string; month: string; year: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    day: get("day"),
    month: MONTHS[Number(get("month")) - 1] ?? "",
    year: get("year"),
    // en-GB renders midnight as "24" in some ICU builds; normalise it to "00".
    hour: get("hour") === "24" ? "00" : get("hour"),
    minute: get("minute"),
  };
}

export function formatHiringDate(d: Date | string | null | undefined): string {
  const date = toDate(d);
  if (!date) return "\u2014";
  const p = istParts(date);
  return `${p.day} ${p.month} ${p.year}`;
}

/** dd MMM yyyy, HH:mm in IST — for timelines where the time matters. */
export function formatHiringDateTime(d: Date | string | null | undefined): string {
  const date = toDate(d);
  if (!date) return "\u2014";
  const p = istParts(date);
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date;
}
