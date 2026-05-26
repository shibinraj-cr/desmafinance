import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";

export async function GET(req: Request) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const rows = await prisma.hrAttendanceRegularization.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      employee: { select: { empCode: true, name: true } },
    },
  });
  return NextResponse.json({ requests: rows });
}
