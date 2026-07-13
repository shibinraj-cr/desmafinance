import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { cycleWindowForMonth, cycleMonthForDate } from "@/lib/hr-data";
import { loadAttendanceScorecard } from "@/lib/hr-attendance-score-data";
import { AttendanceScorecardClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HrAttendanceScorecardPage({
  searchParams,
}: {
  searchParams?: { month?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Attendance Scorecard" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }

  const today = new Date();
  const requested =
    searchParams?.month && /^\d{4}-\d{2}$/.test(searchParams.month)
      ? searchParams.month
      : cycleMonthForDate(today);

  const board = await loadAttendanceScorecard(requested);

  // Human label for the rolling window (start of the oldest cycle → end of the newest).
  const winStart = cycleWindowForMonth(board.cycleMonths[0]).start;
  const winEnd = cycleWindowForMonth(requested).end;
  const windowLabel = `${winStart.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" })} → ${winEnd.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}`;

  const [yStr, mStr] = requested.split("-").map(Number);
  const prevMonth = mStr === 1 ? `${yStr - 1}-12` : `${yStr}-${String(mStr - 1).padStart(2, "0")}`;
  const nextMonth = mStr === 12 ? `${yStr + 1}-01` : `${yStr}-${String(mStr + 1).padStart(2, "0")}`;

  return (
    <>
      <TopBar
        title="Attendance Scorecard"
        subtitle={`Rolling ${board.cycleMonths.length} cycles · ${windowLabel}`}
      />
      <div className="p-margin space-y-lg">
        <AttendanceScorecardClient
          monthKey={requested}
          prevMonth={prevMonth}
          nextMonth={nextMonth}
          windowLabel={windowLabel}
          cycleMonths={board.cycleMonths}
          scores={board.scores}
          flagged={board.flagged}
        />
      </div>
    </>
  );
}
