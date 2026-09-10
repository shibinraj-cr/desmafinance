import { prisma } from "@/lib/prisma";
import { istToday, isLeapYear, type CalendarDay } from "@/lib/dates";

/**
 * Birthdays and work anniversaries, for the band under the header and for the
 * one-time greeting the celebrant sees.
 *
 * The governing decision here is **derive, don't store**. Whose day it is today
 * is a pure function of the date and the employee table, so there is no daily
 * job to babysit, no backfill, and nothing goes stale when HR corrects a date of
 * birth. The only thing worth persisting is the fact that somebody has already
 * been greeted this year — that is `HrCelebration`, written once per person per
 * kind per year.
 */

export type CelebrationKind = "birthday" | "anniversary";

/** One celebrating employee, as the band and the greeting need them. */
export type Celebration = {
  employeeId: string;
  kind: CelebrationKind;
  name: string;
  /** First word of the name — what the greeting addresses them by. */
  firstName: string;
  department: string | null;
  photoUrl: string | null;
  /** The linked login, so the shell can tell whether this is the viewer. */
  userId: string | null;
  /** Age turned today. Null for anniversaries, and null when HR keeps age private. */
  age: number | null;
  /** Completed years of service. Null for birthdays. */
  years: number | null;
  /** The calendar year this celebration belongs to — the `HrCelebration` key. */
  year: number;
};

/**
 * How many celebrations the band will show. Anniversaries run every year, not
 * only round ones, so a mid-size office sees roughly two celebration-days per
 * employee per year and three-or-four-celebrant days are not rare. Past a
 * handful the reel becomes a minute-long loop nobody reads to the end, so the
 * overflow goes to the click-through instead.
 */
export const BAND_CELEBRATION_LIMIT = 4;

/** The settings row's shape, with the defaults used when HR has never saved one. */
export type CelebrationSettings = {
  bandEnabled: boolean;
  greetingEnabled: boolean;
  anniversaryEnabled: boolean;
  showAge: boolean;
  template: string;
  anniversaryTemplate: string;
};

export const CELEBRATION_DEFAULTS: CelebrationSettings = {
  bandEnabled: true,
  greetingEnabled: true,
  anniversaryEnabled: true,
  // Age is off by default: it is inferred from a date of birth the employee gave
  // HR for payroll, not for publication. HR can turn it on deliberately.
  showAge: false,
  template: "Happy birthday, {{name}}! Wishing you a wonderful year ahead. — Team DESMA",
  anniversaryTemplate:
    "Thank you for everything you have built here, {{name}}. Here is to the year ahead. — Team DESMA",
};

/**
 * Does a stored date-of-birth / date-of-joining fall on `today`?
 *
 * The 29 February rule: in a non-leap year those birthdays are celebrated on
 * the 28th rather than 1 March, so the greeting stays inside the month the
 * person thinks of as theirs.
 */
export function fallsOnDay(date: Date, today: CalendarDay): boolean {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  if (month === today.month && day === today.day) return true;
  return (
    month === 2 &&
    day === 29 &&
    today.month === 2 &&
    today.day === 28 &&
    !isLeapYear(today.year)
  );
}

/** Load the settings row, falling back to the documented defaults. */
export async function celebrationSettings(): Promise<CelebrationSettings> {
  const row = await prisma.hrBirthdaySettings
    .findFirst({ where: { singleton: true } })
    .catch(() => null);
  if (!row) return CELEBRATION_DEFAULTS;
  return {
    bandEnabled: row.bandEnabled,
    greetingEnabled: row.greetingEnabled,
    anniversaryEnabled: row.anniversaryEnabled,
    showAge: row.showAge,
    template: row.template,
    anniversaryTemplate: row.anniversaryTemplate,
  };
}

/**
 * Everyone celebrating today, birthdays first, then anniversaries, each group
 * by name so the order is stable across renders.
 *
 * Reads the whole active-employee list and filters in JS rather than pushing
 * month/day extraction into SQL: the table is a few hundred rows at most, the
 * select carries no joins, and keeping it in Prisma means the 29 February rule
 * lives in one place that is directly unit-testable.
 *
 * Best-effort by design. This runs on every page render in the app shell, so a
 * failure here must cost the band, never the app.
 */
export async function celebrationsToday(opts?: {
  now?: Date;
  settings?: CelebrationSettings;
}): Promise<Celebration[]> {
  const today = istToday(opts?.now);
  const settings = opts?.settings ?? (await celebrationSettings());

  const rows = await prisma.employee
    .findMany({
      where: {
        active: true,
        celebrationOptOut: false,
        OR: [{ dob: { not: null } }, { joinDate: { not: null } }],
      },
      select: {
        id: true,
        name: true,
        department: true,
        photoUrl: true,
        userId: true,
        dob: true,
        joinDate: true,
      },
    })
    .catch(() => []);

  const birthdays: Celebration[] = [];
  const anniversaries: Celebration[] = [];

  for (const r of rows) {
    const base = {
      employeeId: r.id,
      name: r.name,
      firstName: r.name.trim().split(/\s+/)[0] || r.name,
      department: r.department,
      photoUrl: r.photoUrl,
      userId: r.userId,
      year: today.year,
    };

    if (r.dob && fallsOnDay(r.dob, today)) {
      const age = today.year - r.dob.getUTCFullYear();
      birthdays.push({
        ...base,
        kind: "birthday",
        age: settings.showAge && age > 0 ? age : null,
        years: null,
      });
    }

    if (settings.anniversaryEnabled && r.joinDate && fallsOnDay(r.joinDate, today)) {
      const years = today.year - r.joinDate.getUTCFullYear();
      // A join date landing on today in the year they joined is a start date,
      // not an anniversary. Anniversaries begin at year one.
      if (years >= 1) {
        anniversaries.push({ ...base, kind: "anniversary", age: null, years });
      }
    }
  }

  const byName = (a: Celebration, b: Celebration) => a.name.localeCompare(b.name);
  return [...birthdays.sort(byName), ...anniversaries.sort(byName)];
}

/**
 * The celebration the signed-in user should be *greeted* for, or null.
 *
 * Takes the already-loaded list so an ordinary day costs nothing extra: only
 * when the viewer is actually in it do we spend a query asking whether they
 * have been greeted already. A person with no linked Employee simply never
 * matches — they still appear in everyone else's band.
 */
export async function pendingGreeting(
  userId: string,
  todays: Celebration[],
): Promise<Celebration | null> {
  const mine = todays.filter((c) => c.userId === userId);
  if (mine.length === 0) return null;

  // A birthday and an anniversary can land on the same day; the birthday wins
  // the greeting and the anniversary still shows on the band.
  const already = await prisma.hrCelebration
    .findMany({
      where: {
        employeeId: mine[0].employeeId,
        year: mine[0].year,
        kind: { in: mine.map((c) => c.kind) },
      },
      select: { kind: true },
    })
    .catch(() => null);

  // A failed lookup means we cannot prove the greeting is unsent. Staying quiet
  // is the safe failure: a missed greeting is a disappointment, a greeting that
  // re-fires on every page load is a bug the whole office sees.
  if (already === null) return null;

  const greeted = new Set(already.map((r) => r.kind));
  return mine.find((c) => !greeted.has(c.kind)) ?? null;
}

/** Render a template. Unknown placeholders are left alone rather than blanked. */
export function renderGreeting(c: Celebration, settings: CelebrationSettings): string {
  const template = c.kind === "birthday" ? settings.template : settings.anniversaryTemplate;
  return template
    .replaceAll("{{name}}", c.firstName)
    .replaceAll("{{fullName}}", c.name)
    .replaceAll("{{dept}}", c.department ?? "")
    .replaceAll("{{years}}", c.years === null ? "" : String(c.years));
}

// ──────────────────────────────────────────────────────────────────────
// Calendar — the same two kinds, but looked up ahead and behind rather
// than only for today.
//
// `celebrationsToday` above is the hot path: it runs on every page render
// in the app shell, so its select carries no joins and no columns the band
// will not print. These functions back the Celebrations pages instead, where
// one extra round trip is affordable and the reader wants designation and
// employee code too. The two share their *rules* — `fallsOnDay`, the opt-out
// filter, the anniversary switch — so the calendar can never disagree with
// the band about who is celebrating.
// ──────────────────────────────────────────────────────────────────────

/** An employee as the calendar reads them, before occasions are derived. */
export type Celebrant = {
  employeeId: string;
  empCode: string;
  name: string;
  designation: string | null;
  department: string | null;
  photoUrl: string | null;
  dob: Date | null;
  joinDate: Date | null;
};

/** One occasion on the calendar: this person, this kind, this date. */
export type CelebrationEntry = {
  employeeId: string;
  empCode: string;
  kind: CelebrationKind;
  name: string;
  designation: string | null;
  department: string | null;
  photoUrl: string | null;
  /** Month of the occasion, 1–12. */
  month: number;
  /** Day it is observed — 28 for a 29 February date in a non-leap year. */
  day: number;
  /** "MM-DD", for display and for sorting within a month. */
  monthDay: string;
  /** Whole days from today. 0 = today; negative = already passed this month. */
  delta: number;
  /** Age being turned. Birthdays only. */
  age: number | null;
  /** Completed years of service. Anniversaries only. */
  years: number | null;
};

/**
 * Everyone the calendar can draw from: active, not opted out, with at least
 * one date on file. Anniversaries are dropped at source when HR has switched
 * them off, so no caller has to remember to check.
 */
export async function loadCelebrants(settings?: CelebrationSettings): Promise<Celebrant[]> {
  const s = settings ?? (await celebrationSettings());
  const rows = await prisma.employee
    .findMany({
      where: {
        active: true,
        celebrationOptOut: false,
        OR: [{ dob: { not: null } }, { joinDate: { not: null } }],
      },
      select: {
        id: true,
        empCode: true,
        name: true,
        designation: true,
        department: true,
        photoUrl: true,
        dob: true,
        joinDate: true,
        designationRef: { select: { name: true } },
        departments: { where: { isPrimary: true }, include: { department: true } },
      },
      orderBy: { name: "asc" },
    })
    .catch(() => []);

  return rows.map((r) => ({
    employeeId: r.id,
    empCode: r.empCode,
    name: r.name,
    designation: r.designationRef?.name ?? r.designation,
    department: r.departments[0]?.department.name ?? r.department,
    photoUrl: r.photoUrl,
    dob: r.dob,
    joinDate: s.anniversaryEnabled ? r.joinDate : null,
  }));
}

/**
 * The UTC timestamp on which a month/day is observed in a given year.
 * 29 February is observed on the 28th when the year has no 29th — the same
 * rule `fallsOnDay` applies, kept here so a date can never be listed on the
 * calendar for a day it would not actually fire on.
 */
function observedOn(year: number, month: number, day: number): number {
  if (month === 2 && day === 29 && !isLeapYear(year)) return Date.UTC(year, 1, 28);
  return Date.UTC(year, month - 1, day);
}

/** Whole days between two UTC midnights. */
function daysBetween(fromTs: number, toTs: number): number {
  return Math.round((toTs - fromTs) / 86_400_000);
}

/** Every occasion a person has, as (kind, source date) pairs. */
function occasionsOf(c: Celebrant): Array<{ kind: CelebrationKind; on: Date }> {
  const out: Array<{ kind: CelebrationKind; on: Date }> = [];
  if (c.dob) out.push({ kind: "birthday", on: c.dob });
  if (c.joinDate) out.push({ kind: "anniversary", on: c.joinDate });
  return out;
}

function entryFor(
  c: Celebrant,
  kind: CelebrationKind,
  source: Date,
  /** The year the occasion is being counted in — decides age and years. */
  inYear: number,
  todayTs: number,
): CelebrationEntry {
  const month = source.getUTCMonth() + 1;
  const rawDay = source.getUTCDate();
  const ts = observedOn(inYear, month, rawDay);
  const observedDay = new Date(ts).getUTCDate();
  const count = inYear - source.getUTCFullYear();
  return {
    employeeId: c.employeeId,
    empCode: c.empCode,
    kind,
    name: c.name,
    designation: c.designation,
    department: c.department,
    photoUrl: c.photoUrl,
    month,
    day: observedDay,
    monthDay: `${String(month).padStart(2, "0")}-${String(observedDay).padStart(2, "0")}`,
    delta: daysBetween(todayTs, ts),
    age: kind === "birthday" ? count : null,
    years: kind === "anniversary" ? count : null,
  };
}

/**
 * Every occasion falling in `month` of `year`, birthdays and anniversaries
 * together, in date order — the "who are we celebrating in September" view.
 *
 * An anniversary that has not yet been completed in that year is left out: in
 * the year somebody joined, the date on the calendar is a start date, not an
 * anniversary, and listing it as "0 years" reads like a bug.
 */
export function celebrationsInMonth(
  celebrants: Celebrant[],
  month: number,
  year: number,
  now: Date = new Date(),
): CelebrationEntry[] {
  const today = istToday(now);
  const todayTs = Date.UTC(today.year, today.month - 1, today.day);
  const out: CelebrationEntry[] = [];

  for (const c of celebrants) {
    for (const { kind, on } of occasionsOf(c)) {
      if (on.getUTCMonth() + 1 !== month) continue;
      const entry = entryFor(c, kind, on, year, todayTs);
      if (kind === "anniversary" && (entry.years ?? 0) < 1) continue;
      out.push(entry);
    }
  }

  return out.sort(
    (a, b) => a.day - b.day || a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind),
  );
}

/**
 * The next `windowDays` of occasions, soonest first, wrapping across the turn
 * of the year — so on 28 December the first week of January is still "coming
 * up", counted against the year it will actually fall in.
 */
export function upcomingCelebrations(
  celebrants: Celebrant[],
  windowDays = 14,
  now: Date = new Date(),
): CelebrationEntry[] {
  const today = istToday(now);
  const todayTs = Date.UTC(today.year, today.month - 1, today.day);
  const out: CelebrationEntry[] = [];

  for (const c of celebrants) {
    for (const { kind, on } of occasionsOf(c)) {
      const month = on.getUTCMonth() + 1;
      const day = on.getUTCDate();
      // This year's occurrence if it is still to come, otherwise next year's.
      const year = observedOn(today.year, month, day) >= todayTs ? today.year : today.year + 1;
      const entry = entryFor(c, kind, on, year, todayTs);
      if (entry.delta < 0 || entry.delta > windowDays) continue;
      if (kind === "anniversary" && (entry.years ?? 0) < 1) continue;
      out.push(entry);
    }
  }

  return out.sort(
    (a, b) => a.delta - b.delta || a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind),
  );
}

/** CSV for the HR export — one row per occasion, both kinds. */
export function celebrationsToCsv(entries: CelebrationEntry[]): string {
  const header = ["Emp Code", "Name", "Occasion", "Designation", "Department", "Date (MM-DD)", "Turning / Years"];
  const body = entries.map((e) => [
    e.empCode,
    csvCell(e.name),
    e.kind === "birthday" ? "Birthday" : "Work anniversary",
    csvCell(e.designation ?? ""),
    csvCell(e.department ?? ""),
    e.monthDay,
    e.kind === "birthday" ? String(e.age ?? "") : String(e.years ?? ""),
  ]);
  return [header, ...body].map((row) => row.join(",")).join("\n");
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
