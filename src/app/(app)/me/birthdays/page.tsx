import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import {
  birthdaysForMonth,
  loadActiveEmployeeBirthdays,
  monthLabel,
  upcomingBirthdays,
} from "@/lib/hr-birthdays";
import { celebrationsToday } from "@/lib/celebrations";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export default async function MyBirthdaysPage({
  searchParams,
}: {
  searchParams?: { month?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  const now = new Date();
  const monthNum =
    searchParams?.month && /^\d{1,2}$/.test(searchParams.month)
      ? Math.min(12, Math.max(1, Number(searchParams.month)))
      : now.getUTCMonth() + 1;
  // Today's list comes from the celebration query rather than the birthday
  // calendar, because this is where the band under the header lands: it names
  // work anniversaries too, and a page that answered with birthdays alone would
  // not contain what the reader just clicked on.
  const [all, today] = await Promise.all([
    loadActiveEmployeeBirthdays(),
    celebrationsToday(),
  ]);
  const monthly = birthdaysForMonth(all, monthNum);
  const upcoming = upcomingBirthdays(all, 14);
  return (
    <>
      <TopBar
        title="Colleague Birthdays"
        subtitle={`${today.length} celebrating today · ${monthly.length} birthdays in ${monthLabel(monthNum)}`}
      />
      <div className="p-margin space-y-lg">
        {today.length > 0 && (
          <Section title="Today">
            <div className="space-y-xs">
              {today.map((c) => (
                <div
                  key={`${c.employeeId}:${c.kind}`}
                  className="flex items-center gap-sm border border-outline-variant rounded-lg px-md py-sm"
                >
                  <div className="w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center text-h3">
                    {c.kind === "birthday" ? "🎂" : "🎉"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{c.name}</p>
                    <p className="text-caption text-on-surface-variant truncate">
                      {c.department ?? "—"}
                    </p>
                  </div>
                  <p className="font-semibold">
                    {c.kind === "birthday"
                      ? c.age !== null
                        ? `Turns ${c.age}`
                        : "Birthday"
                      : `${c.years} year${c.years === 1 ? "" : "s"}`}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="Upcoming (next 14 days)">
          {upcoming.length === 0 ? (
            <p className="py-md text-center text-on-surface-variant">No upcoming birthdays.</p>
          ) : (
            <div className="space-y-xs">
              {upcoming.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-sm border border-outline-variant rounded-lg px-md py-sm"
                >
                  <div className="w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold">
                    {b.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((s) => s[0]?.toUpperCase() ?? "")
                      .join("")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{b.name}</p>
                    <p className="text-caption text-on-surface-variant truncate">
                      {b.designation ?? "—"} · {b.department ?? "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold tabular-nums">{b.dob.slice(5)}</p>
                    <p className="text-caption text-on-surface-variant">
                      {b.delta === 0 ? "Today" : `in ${b.delta} days`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title={`${monthLabel(monthNum)}`}
          action={
            <div className="flex items-center gap-xs">
              {MONTH_NAMES.map((m, i) => (
                <Link
                  key={m}
                  href={`/me/birthdays?month=${i + 1}`}
                  className={`px-xs py-[1px] rounded text-caption font-semibold ${i + 1 === monthNum ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"}`}
                >
                  {m}
                </Link>
              ))}
            </div>
          }
        >
          {monthly.length === 0 ? (
            <p className="py-md text-center text-on-surface-variant">No birthdays this month.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-sm">
              {monthly.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center gap-sm border border-outline-variant rounded-lg px-md py-sm"
                >
                  <div className="w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold">
                    {b.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((s) => s[0]?.toUpperCase() ?? "")
                      .join("")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{b.name}</p>
                    <p className="text-caption text-on-surface-variant truncate">
                      {b.designation ?? "—"}
                    </p>
                  </div>
                  <p className="font-bold tabular-nums">{b.dob.slice(5)}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
