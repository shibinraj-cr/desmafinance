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
