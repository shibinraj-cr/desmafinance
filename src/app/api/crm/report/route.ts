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
import { closeDayCheck, computeLeadReport, leadReportJson } from "@/lib/crm-lead-report-data";
import { closeBlockedMessage } from "@/lib/crm-lead-report";

export const dynamic = "force-dynamic";

// POST /api/crm/report — submit the signed-in BDE's day ("Close the day").
// The report is always for the session user (managers never submit on a BDE's
// behalf); the KPI/detail snapshot and the lead report are recomputed
// server-side and never trusted from the client. Submitting locks the day; it
// can be submitted again only after an admin unlocks it, and never once reviewed.
const SubmitSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: z.string().trim().min(1).max(5000),
  blockers: z.string().trim().max(5000).optional(),
  planNext: z.string().trim().max(5000).optional(),
});

export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  // Only an active L1/L2 BDE may author a report (isBde already encodes
  // active && l1|l2). Supervisors/admins review, they don't submit.
  if (!access.isBde) throw forbidden("not_a_bde");

  const input = SubmitSchema.parse(await req.json().catch(() => null));
  // Normalise + validate the day, then enforce the backdate window server-side.
  const day = resolveReportDay(input.day);
  if (day !== input.day) throw unprocessable("invalid_day", "invalid_day");
  if (!canSubmitOn(day)) throw unprocessable("day_out_of_window", "day_out_of_window");

  // A reviewed report is frozen — no silent overwrite.
  const existing = await prisma.crmDailyReport.findUnique({
    where: { userId_day: { userId, day: toPrismaDate(day) } },
    select: { status: true, locked: true },
  });
  if (existing?.status === "reviewed") throw conflict("already_reviewed", "already_reviewed");
  if (existing?.locked) {
    throw conflict("This day is already submitted. Ask an admin to unlock it to change it.", "day_locked");
  }

  // Recompute the snapshot server-side — the client never supplies metrics.
  const now = new Date();
  const [{ metrics, details }, leadReport] = await Promise.all([
    computeDailyReport({ userId, dayStr: day }),
    computeLeadReport(userId, day, now),
  ]);
  // Closing today with leads still due before the cutoff would freeze them as
  // "pending" in a report that is meant to show the misses.
  const close = await closeDayCheck(userId, leadReport, now);
  if (!close.ok) throw conflict(closeBlockedMessage(close, new Date(close.cutoff)), "leads_pending");
  const snapshot = {
    metrics: metrics as unknown as Prisma.InputJsonValue,
    details: details as unknown as Prisma.InputJsonValue,
    leadReport: leadReportJson(leadReport),
    locked: true,
  };
  const narrative = {
    summary: input.summary,
    blockers: input.blockers || null,
    planNext: input.planNext || null,
  };

  const report = await prisma.crmDailyReport.upsert({
    where: { userId_day: { userId, day: toPrismaDate(day) } },
    create: { userId, day: toPrismaDate(day), status: "submitted", ...narrative, ...snapshot },
    update: { status: "submitted", submittedAt: new Date(), ...narrative, ...snapshot },
    select: { id: true, status: true },
  });

  return NextResponse.json({ ok: true, report }, { status: 201 });
});
