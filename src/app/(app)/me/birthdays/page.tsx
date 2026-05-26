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
  const all = await loadActiveEmployeeBirthdays();
  const monthly = birthdaysForMonth(all, monthNum);
  const upcoming = upcomingBirthdays(all, 14);
  return (
    <>
      <TopBar
        title="Colleague Birthdays"
        subtitle={`${monthly.length} in ${monthLabel(monthNum)} · ${upcoming.length} in next two weeks`}
      />
      <div className="p-margin space-y-lg">
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
