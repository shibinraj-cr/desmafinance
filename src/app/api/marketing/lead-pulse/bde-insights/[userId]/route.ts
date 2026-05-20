import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import {
  buildBdeInsightSnapshot,
  buildBdeInsightFeedback,
  type InsightQuestion,
} from "@/lib/lead-pulse-bde-insights";
import { todayIst } from "@/lib/lead-pulse-dates";

export const dynamic = "force-dynamic";

const YearMonth = z.object({
  year: z.number().int().min(2024).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
});

function defaultYearMonth() {
  const today = todayIst();
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
}

/**
 * Visibility:
 * - L1/L2 BDE: can view + answer their own row only.
 * - Supervisor / admin: can view (read-only) any BDE's row.
 *
 * Returns the persisted LeadPulseBdeInsight if one exists for the
 * (userId, year, month). If none exists, returns `null` so the client
 * can show a "Generate" button.
 */
export async function GET(req: NextRequest, { params }: { params: { userId: string } }) {
  const { perms, userId: actorId } = await getCurrentUserAndPermissions();
  if (!perms || !actorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(actorId, perms);

  if (params.userId !== actorId && !access.canSupervise) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || defaultYearMonth().year;
  const month = Number(url.searchParams.get("month")) || defaultYearMonth().month;

  const row = await prisma.leadPulseBdeInsight.findUnique({
    where: { userId_year_month: { userId: params.userId, year, month } },
  });
  return NextResponse.json({ row });
}

/**
 * Generate / regenerate the insight + questions for (userId, year, month).
 * If a row already exists in `answered` state, refuses to overwrite —
 * supervisor / BDE can explicitly delete and regenerate via a different
 * endpoint if needed (not built v1).
 */
export async function POST(req: NextRequest, { params }: { params: { userId: string } }) {
  const { perms, userId: actorId } = await getCurrentUserAndPermissions();
  if (!perms || !actorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(actorId, perms);
  if (params.userId !== actorId && !access.canSupervise) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = YearMonth.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const { year, month } = { ...defaultYearMonth(), ...parsed.data };

  const lpRole = await prisma.leadPulseRole.findUnique({ where: { userId: params.userId } });
  if (!lpRole || (lpRole.role !== "l1" && lpRole.role !== "l2")) {
    return NextResponse.json({ error: "not_a_bde" }, { status: 400 });
  }

  const existing = await prisma.leadPulseBdeInsight.findUnique({
    where: { userId_year_month: { userId: params.userId, year, month } },
  });
  if (existing && existing.status === "answered") {
    return NextResponse.json(
      { error: "already_answered", row: existing },
      { status: 409 },
    );
  }

  const snap = await buildBdeInsightSnapshot({
    userId: params.userId,
    displayName: lpRole.displayName,
    role: lpRole.role as "l1" | "l2",
    year,
    month,
  });

  const row = existing
    ? await prisma.leadPulseBdeInsight.update({
        where: { id: existing.id },
        data: {
          analysis: snap.analysis,
          questions: snap.questions,
          answers: undefined,
          feedback: null,
          status: "draft",
        },
      })
    : await prisma.leadPulseBdeInsight.create({
        data: {
          userId: params.userId,
          year,
          month,
          analysis: snap.analysis,
          questions: snap.questions,
          status: "draft",
        },
      });

  await prisma.leadPulseAuditLog.create({
    data: {
      actorUserId: actorId,
      eventType: "bde_insight_generated",
      targetId: row.id,
      metadata: { userId: params.userId, year, month, metrics: snap.metrics },
    },
  });

  return NextResponse.json({ row });
}

const PatchSchema = z.object({
  year: z.number().int().min(2024).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
  answers: z.record(z.string(), z.string().max(2000)),
});

/**
 * BDE submits answers. Builds the feedback section, sets status=answered,
 * stamps answeredAt. Only the BDE themself can submit answers — even
 * supervisors can read but not impersonate.
 */
export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  const { perms, userId: actorId } = await getCurrentUserAndPermissions();
  if (!perms || !actorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (params.userId !== actorId) {
    return NextResponse.json({ error: "forbidden_self_only" }, { status: 403 });
  }
  void perms;

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const { year, month } = { ...defaultYearMonth(), ...parsed.data };

  const existing = await prisma.leadPulseBdeInsight.findUnique({
    where: { userId_year_month: { userId: params.userId, year, month } },
  });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (existing.status === "answered") {
    return NextResponse.json({ error: "already_answered" }, { status: 409 });
  }

  const lpRole = await prisma.leadPulseRole.findUnique({ where: { userId: params.userId } });
  if (!lpRole) return NextResponse.json({ error: "not_a_bde" }, { status: 400 });

  // Rebuild metrics so the feedback is anchored to current data — the
  // questions persist as the BDE saw them, but the "bottom line" math
  // uses the freshest numbers.
  const snap = await buildBdeInsightSnapshot({
    userId: params.userId,
    displayName: lpRole.displayName,
    role: lpRole.role as "l1" | "l2",
    year,
    month,
  });

  const feedback = buildBdeInsightFeedback({
    displayName: lpRole.displayName,
    questions: existing.questions as unknown as InsightQuestion[],
    answers: parsed.data.answers,
    metrics: snap.metrics,
  });

  const row = await prisma.leadPulseBdeInsight.update({
    where: { id: existing.id },
    data: {
      answers: parsed.data.answers,
      feedback,
      status: "answered",
      answeredAt: new Date(),
    },
  });

  await prisma.leadPulseAuditLog.create({
    data: {
      actorUserId: actorId,
      eventType: "bde_insight_answered",
      targetId: row.id,
      metadata: { userId: params.userId, year, month, answerKeys: Object.keys(parsed.data.answers) },
    },
  });

  return NextResponse.json({ row });
}
