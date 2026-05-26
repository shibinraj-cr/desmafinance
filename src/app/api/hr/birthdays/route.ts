import { NextResponse } from "next/server";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, isEmployeePortalUser } from "@/lib/hr-rbac";
import { loadActiveEmployeeBirthdays, upcomingBirthdays } from "@/lib/hr-birthdays";

/** Read-only birthday roster. HR users get the full list; ESS users
 * also get the list (visible to all colleagues). */
export async function GET(req: Request) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isHrUser(perms) && !isEmployeePortalUser(perms)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  const upcomingDays = Number(url.searchParams.get("upcomingDays") ?? "");
  const all = await loadActiveEmployeeBirthdays();
  if (month && /^\d{1,2}$/.test(month)) {
    const m = Number(month);
    return NextResponse.json({
      rows: all
        .filter((r) => Number(r.dob.slice(5, 7)) === m)
        .sort((a, b) => a.dob.localeCompare(b.dob)),
    });
  }
  if (!Number.isNaN(upcomingDays) && upcomingDays > 0) {
    return NextResponse.json({ rows: upcomingBirthdays(all, upcomingDays) });
  }
  return NextResponse.json({ rows: all });
}
