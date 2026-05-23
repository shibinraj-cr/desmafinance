import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { monthKeyFromDate, parseMonthKey } from "@/lib/hr-data";
import { AttendanceClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HrAttendancePage({
  searchParams,
}: {
  searchParams?: { month?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Attendance" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }

  const today = new Date();
  const requested = searchParams?.month && /^\d{4}-\d{2}$/.test(searchParams.month)
    ? searchParams.month
    : monthKeyFromDate(today);
  const { year, month, start, end } = parseMonthKey(requested);

  const [uploads, days, employees] = await Promise.all([
    prisma.hrAttendanceUpload.findMany({
      where: { monthKey: requested },
      orderBy: { uploadedAt: "desc" },
      take: 5,
      include: { uploadedBy: { select: { username: true } } },
    }),
    prisma.hrAttendanceDay.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: [{ employeeId: "asc" }, { date: "asc" }],
      include: { employee: { select: { empCode: true, name: true } } },
    }),
    prisma.employee.findMany({
      where: { active: true },
      orderBy: { empCode: "asc" },
      select: { id: true, empCode: true, name: true },
    }),
  ]);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const grid: Record<
    string,
    Record<
      number,
      {
        status: string;
        in: string | null;
        out: string | null;
        work: number | null;
        ot: number | null;
        remark: string | null;
      }
    >
  > = {};
  const summary: Record<string, { P: number; HD: number; A: number; WO: number; HL: number; LV: number }> = {};
  for (const d of days) {
    const day = d.date.getUTCDate();
    grid[d.employeeId] ??= {};
    grid[d.employeeId][day] = {
      status: d.status,
      in: d.inTime,
      out: d.outTime,
      work: d.workMinutes,
      ot: d.otMinutes,
      remark: d.remark,
    };
    summary[d.employeeId] ??= { P: 0, HD: 0, A: 0, WO: 0, HL: 0, LV: 0 };
    const key = d.status as keyof (typeof summary)[string];
    if (key in summary[d.employeeId]) summary[d.employeeId][key]++;
  }

  return (
    <>
      <TopBar title="Attendance" subtitle={`${requested} · ${daysInMonth} days`} />
      <div className="p-margin space-y-lg">
        <AttendanceClient
          monthKey={requested}
          daysInMonth={daysInMonth}
          canUpload={canApproveHr(perms)}
          uploads={uploads.map((u) => ({
            id: u.id,
            filename: u.filename ?? "(no filename)",
            rowCount: u.rowCount,
            uploadedAt: u.uploadedAt.toISOString(),
            uploadedBy: u.uploadedBy?.username ?? "—",
          }))}
          employees={employees}
          grid={grid}
          summary={summary}
        />
      </div>
    </>
  );
}
