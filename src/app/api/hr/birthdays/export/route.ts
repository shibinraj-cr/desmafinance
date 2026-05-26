import { NextResponse } from "next/server";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { birthdaysToCsv, loadActiveEmployeeBirthdays } from "@/lib/hr-birthdays";

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await loadActiveEmployeeBirthdays();
  const sorted = [...rows].sort((a, b) => a.dob.slice(5).localeCompare(b.dob.slice(5)));
  const csv = birthdaysToCsv(sorted);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="desgro-birthdays-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
