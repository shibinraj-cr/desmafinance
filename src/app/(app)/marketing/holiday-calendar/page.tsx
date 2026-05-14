import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { prisma } from "@/lib/prisma";
import { todayIst } from "@/lib/lead-pulse-dates";
import { HolidayCalendarClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HolidayCalendarPage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);

  const today = todayIst();
  const yearNow = Number(today.slice(0, 4));
  const monthNow = Number(today.slice(5, 7));
  const year = searchParams.year ? Number(searchParams.year) : yearNow;
  const month = searchParams.month ? Number(searchParams.month) : monthNow;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) redirect("/marketing/holiday-calendar");
  if (!Number.isInteger(month) || month < 1 || month > 12) redirect("/marketing/holiday-calendar");

  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  const rows = await prisma.holiday.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
    select: { id: true, date: true, label: true, notes: true },
  });
  const holidays = rows.map((r) => ({
    id: r.id,
    date: r.date.toISOString().slice(0, 10),
    label: r.label,
    notes: r.notes,
  }));

  return (
    <HolidayCalendarClient
      year={year}
      month={month}
      todayStr={today}
      holidays={holidays}
      canEdit={access.canSupervise}
    />
  );
}
