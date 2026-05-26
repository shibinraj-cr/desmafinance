import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";

const Schema = z.object({
  autoWishEnabled: z.boolean(),
  reminderDays: z.number().int().min(0).max(30),
  channel: z.enum(["email", "whatsapp", "both", "disabled"]),
  template: z.string().min(5).max(500),
});

async function getSettings() {
  const row = await prisma.hrBirthdaySettings.findFirst({ where: { singleton: true } });
  if (row) return row;
  return prisma.hrBirthdaySettings.create({
    data: { singleton: true },
  });
}

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const settings = await getSettings();
  return NextResponse.json({ settings });
}

export async function PUT(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const existing = await getSettings();
  const updated = await prisma.hrBirthdaySettings.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? null,
      eventType: "birthday_settings_updated",
      entityType: "HrBirthdaySettings",
      metadata: parsed.data,
    },
  });
  return NextResponse.json({ settings: updated });
}
