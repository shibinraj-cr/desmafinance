import { NextResponse } from "next/server";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { celebrationsToCsv, loadCelebrants, celebrationsInMonth } from "@/lib/celebrations";
import { istToday } from "@/lib/dates";

/**
 * The whole celebration calendar as CSV — every birthday and work anniversary,
 * in date order from January.
 *
 * Exports what the page shows. When this was birthdays-only and the page had
 * grown anniversaries, the download quietly disagreed with the screen it sat
 * next to.
 */
export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const now = new Date();
  const year = istToday(now).year;
  const celebrants = await loadCelebrants();
  const entries = Array.from({ length: 12 }, (_, i) =>
    celebrationsInMonth(celebrants, i + 1, year, now),
  ).flat();

  return new NextResponse(celebrationsToCsv(entries), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="desgro-celebrations-${now.toISOString().slice(0, 10)}.csv"`,
    },
  });
}
