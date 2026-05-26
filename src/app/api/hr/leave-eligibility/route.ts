import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await prisma.hrLeaveEligibility.findMany({
    include: {
      employee: { select: { empCode: true, name: true, active: true } },
    },
    orderBy: [{ enabled: "desc" }, { employee: { empCode: "asc" } }],
  });
  return NextResponse.json({ eligibilities: rows });
}
