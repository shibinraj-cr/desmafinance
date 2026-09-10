import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { monthLabel } from "@/lib/hr-birthdays";
import { istToday } from "@/lib/dates";
import {
  celebrationsInMonth,
  celebrationsToday,
  loadCelebrants,
  upcomingCelebrations,
  type CelebrationKind,
} from "@/lib/celebrations";

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
  const ist = istToday(now);
  const monthNum =
    searchParams?.month && /^\d{1,2}$/.test(searchParams.month)
      ? Math.min(12, Math.max(1, Number(searchParams.month)))
      : ist.month;
  // Both kinds throughout. Today keeps its own query — it is the one that
  // respects the "show age" switch, since that is the list the band mirrors.
  const [celebrants, today] = await Promise.all([loadCelebrants(), celebrationsToday()]);
  const monthly = celebrationsInMonth(celebrants, monthNum, ist.year);
  const upcoming = upcomingCelebrations(celebrants, 14);
  return (
    <>
      <TopBar
        title="Celebrations"
        subtitle={`${today.length} celebrating today · ${monthly.length} in ${monthLabel(monthNum)}`}
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
                  <OccasionAvatar kind={c.kind} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-xs flex-wrap">
                      <p className="font-semibold truncate">{c.name}</p>
                      <OccasionChip kind={c.kind} />
                    </div>
                    <p className="text-caption text-on-surface-variant truncate">
                      {c.department ?? "—"}
                    </p>
                  </div>
                  {c.kind === "anniversary" ? (
                    <p className="font-semibold whitespace-nowrap">
                      {c.years} year{c.years === 1 ? "" : "s"}
                    </p>
                  ) : c.age !== null ? (
                    <p className="font-semibold whitespace-nowrap">Turns {c.age}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="Upcoming (next 14 days)">
          {upcoming.length === 0 ? (
            <p className="py-md text-center text-on-surface-variant">
              Nothing coming up in the next two weeks.
            </p>
          ) : (
            <div className="space-y-xs">
              {upcoming.map((e) => (
                <div
                  key={`${e.employeeId}:${e.kind}`}
                  className="flex items-center gap-sm border border-outline-variant rounded-lg px-md py-sm"
                >
                  <OccasionAvatar kind={e.kind} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-xs flex-wrap">
                      <p className="font-semibold truncate">{e.name}</p>
                      <OccasionChip kind={e.kind} />
                    </div>
                    <p className="text-caption text-on-surface-variant truncate">
                      {e.designation ?? "—"} · {e.department ?? "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold tabular-nums">{e.monthDay}</p>
                    <p className="text-caption text-on-surface-variant whitespace-nowrap">
                      {e.delta === 0 ? "Today" : e.delta === 1 ? "Tomorrow" : `in ${e.delta} days`}
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
            <p className="py-md text-center text-on-surface-variant">
              Nothing to celebrate in {monthLabel(monthNum)}.
            </p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-sm">
              {monthly.map((e) => (
                <li
                  key={`${e.employeeId}:${e.kind}`}
                  className="flex items-center gap-sm border border-outline-variant rounded-lg px-md py-sm"
                >
                  <OccasionAvatar kind={e.kind} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{e.name}</p>
                    <div className="flex items-center gap-xs">
                      <OccasionChip kind={e.kind} />
                      {e.kind === "anniversary" ? (
                        <span className="text-caption text-on-surface-variant whitespace-nowrap">
                          {e.years} yr{e.years === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p className="font-bold tabular-nums">{e.monthDay}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

/** Cake or party popper, on the same gold disc the rest of the page uses. */
function OccasionAvatar({ kind }: { kind: CelebrationKind }) {
  return (
    <div className="w-10 h-10 flex-none rounded-full bg-primary text-on-primary flex items-center justify-center text-h3">
      {kind === "birthday" ? "🎂" : "🎉"}
    </div>
  );
}

/**
 * The occasion in words. The emoji above is decoration; this is the part that
 * actually tells a birthday and an anniversary apart.
 */
function OccasionChip({ kind }: { kind: CelebrationKind }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider px-xs py-[1px] rounded-full bg-surface-container border border-outline-variant text-on-surface-variant whitespace-nowrap">
      {kind === "birthday" ? "Birthday" : "Work anniversary"}
    </span>
  );
}
