import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

export async function GET() {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const employee = await prisma.employee.findUnique({
    where: { userId },
    include: {
      shift: true,
      leaveBalances: { orderBy: { year: "desc" }, take: 1 },
    },
  });
  return NextResponse.json({ employee });
}
