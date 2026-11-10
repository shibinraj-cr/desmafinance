import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, conflict, unprocessable } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { toPrismaDate } from "@/lib/lead-pulse-dates";
import { computeDailyReport, resolveReportDay, canSubmitOn } from "@/lib/crm-daily-report";

export const dynamic = "force-dynamic";

// POST /api/crm/report — the BDE's optional remarks on their day. BDEs don't
// submit the report: it is generated automatically at the cutoff
// (generateDayReports, run by the lead-cutoff cron), and remarks never change
// its numbers. A day with no report yet gets a row holding the remarks and a
// live snapshot, unlocked, which the cutoff run then generates over and locks.
// Always the session user's own day; never once a manager has reviewed it.
const RemarksSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: z.string().trim().max(5000).optional(),
  blockers: z.string().trim().max(5000).optional(),
  planNext: z.string().trim().max(5000).optional(),
});

export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  // Only an active L1/L2 BDE has a day report (isBde already encodes
  // active && l1|l2). Supervisors/admins review, they don't write remarks.
  if (!access.isBde) throw forbidden("not_a_bde");

  const input = RemarksSchema.parse(await req.json().catch(() => null));
  // Normalise + validate the day, then enforce the backdate window server-side.
  const day = resolveReportDay(input.day);
  if (day !== input.day) throw unprocessable("invalid_day", "invalid_day");
  if (!canSubmitOn(day)) throw unprocessable("day_out_of_window", "day_out_of_window");

  const where = { userId_day: { userId, day: toPrismaDate(day) } };
  const existing = await prisma.crmDailyReport.findUnique({ where, select: { id: true, status: true } });
  // A reviewed report is frozen — no silent overwrite.
  if (existing?.status === "reviewed") throw conflict("already_reviewed", "already_reviewed");

  const remarks = {
    summary: input.summary ?? "",
    blockers: input.blockers || null,
    planNext: input.planNext || null,
  };
  if (existing) {
    await prisma.crmDailyReport.update({ where, data: remarks });
    return NextResponse.json({ ok: true, report: { id: existing.id } });
  }

  // No report yet: the row needs a snapshot to exist; the cutoff run replaces it.
  const { metrics, details } = await computeDailyReport({ userId, dayStr: day });
  const report = await prisma.crmDailyReport.create({
    data: {
      userId,
      day: toPrismaDate(day),
      status: "submitted",
      ...remarks,
      metrics: metrics as unknown as Prisma.InputJsonValue,
      details: details as unknown as Prisma.InputJsonValue,
      locked: false,
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, report }, { status: 201 });
});
