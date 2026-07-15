import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const Schema = z.object({ notifyOnAssign: z.boolean() });

// POST /api/crm/notifications/settings — update the current user's per-user CRM
// notification preference (whether lead assignments notify them). Only users
// with a LeadPulseRole can be assigned leads, so only they carry this setting.
export async function POST(req: Request) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const role = await prisma.leadPulseRole.findUnique({ where: { userId }, select: { id: true } });
  if (!role) return NextResponse.json({ error: "no_crm_role" }, { status: 400 });
  await prisma.leadPulseRole.update({
    where: { userId },
    data: { notifyOnAssign: parsed.data.notifyOnAssign },
  });
  return NextResponse.json({ ok: true, notifyOnAssign: parsed.data.notifyOnAssign });
}
