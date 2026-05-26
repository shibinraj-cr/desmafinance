import { prisma } from "./prisma";

export type BirthdayRow = {
  id: string;
  empCode: string;
  name: string;
  designation: string | null;
  department: string | null;
  photoUrl: string | null;
  /** YYYY-MM-DD (just MM-DD matters for sort/match). */
  dob: string;
  /** Day-of-year, 1..366 — used for sorting around `today`. */
  doy: number;
  /** Age that will be turned in this year. */
  ageThisYear: number;
};

export type UpcomingBirthday = BirthdayRow & { delta: number };

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthLabel(month: number): string {
  return MONTH_NAMES[month - 1] ?? "";
}

/** Day-of-year (1-based) ignoring leap-day issues for cross-year compare. */
export function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const diff = date.getTime() - start;
  return Math.floor(diff / 86400000);
}

/**
 * All active employees with a DOB. Each row carries pre-computed
 * helpers (`doy`, `ageThisYear`) used by both the dashboard widget
 * and the dedicated birthday page.
 */
export async function loadActiveEmployeeBirthdays(): Promise<BirthdayRow[]> {
  const rows = await prisma.employee.findMany({
    where: { active: true, dob: { not: null } },
    select: {
      id: true,
      empCode: true,
      name: true,
      designation: true,
      department: true,
      photoUrl: true,
      dob: true,
      designationRef: { select: { name: true } },
      departments: { include: { department: true }, where: { isPrimary: true } },
    },
  });
  const year = new Date().getUTCFullYear();
  return rows
    .filter((r) => r.dob)
    .map((r) => {
      const dob = r.dob as Date;
      const synth = new Date(Date.UTC(year, dob.getUTCMonth(), dob.getUTCDate()));
      return {
        id: r.id,
        empCode: r.empCode,
        name: r.name,
        designation: r.designationRef?.name ?? r.designation,
        department: r.departments[0]?.department.name ?? r.department,
        photoUrl: r.photoUrl,
        dob: dob.toISOString().slice(0, 10),
        doy: dayOfYear(synth),
        ageThisYear: year - dob.getUTCFullYear(),
      };
    });
}

/** Birthdays falling in a specific month (1–12). */
export function birthdaysForMonth(rows: BirthdayRow[], month: number): BirthdayRow[] {
  return rows.filter((r) => Number(r.dob.slice(5, 7)) === month).sort((a, b) => a.dob.localeCompare(b.dob));
}

/** Upcoming birthdays within `windowDays`, sorted ascending from today. */
export function upcomingBirthdays(rows: BirthdayRow[], windowDays = 14): UpcomingBirthday[] {
  const today = new Date();
  const todayDoy = dayOfYear(today);
  return rows
    .map((r) => {
      let delta = r.doy - todayDoy;
      if (delta < 0) delta += 366;
      return { ...r, delta };
    })
    .filter((r) => r.delta <= windowDays)
    .sort((a, b) => a.delta - b.delta);
}

/** Build CSV body for the export endpoint. */
export function birthdaysToCsv(rows: BirthdayRow[]): string {
  const header = ["Emp Code", "Name", "Designation", "Department", "DOB (Y-M-D)", "Birthday (M-D)"];
  const body = rows.map((r) => [
    r.empCode,
    csvEscape(r.name),
    csvEscape(r.designation ?? ""),
    csvEscape(r.department ?? ""),
    r.dob,
    r.dob.slice(5),
  ]);
  return [header, ...body].map((row) => row.join(",")).join("\n");
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
