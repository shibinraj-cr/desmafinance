import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RX = /^\d{4}-\d{2}$/;

const CreateSchema = z.object({
  candidateName: z.string().trim().min(1).max(160),
  candidatePhone: z.string().trim().max(40).optional().nullable(),
  serviceId: z.string().min(1),
  sourceId: z.string().min(1),
  expectedCloseDate: z.string().regex(DATE_RX),
  expectedFirstInstallment: z.number().nonnegative().max(100_000_000).default(0),
  notes: z.string().max(2000).optional().nullable(),
  /** Supervisors may create rows on behalf of an L2 BDE. */
  userId: z.string().min(1).optional(),
});

function serialize(p: NonNullable<Awaited<ReturnType<typeof prisma.leadPulsePipeline.findUnique>>>) {
  return {
    ...p,
    expectedCloseDate: p.expectedCloseDate.toISOString().slice(0, 10),
    closedDate: p.closedDate ? p.closedDate.toISOString().slice(0, 10) : null,
    expectedFirstInstallment: Number(p.expectedFirstInstallment.toString()),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/**
 * GET /api/marketing/lead-pulse/pipeline?userId=...&month=YYYY-MM
 *
 * Supervisors can pass any userId (or omit it for all-BDE view).
 * L2 BDEs always see their own rows; userId is ignored if it doesn't
 * match the caller. `month` filters by expectedCloseDate or closedDate
 * falling in that month — handy for the forecast scope.
 */
export async function GET(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);

  const url = new URL(req.url);
  const requestedUserId = url.searchParams.get("userId");
  const month = url.searchParams.get("month");

  const scopedUserId = access.canSupervise
    ? requestedUserId || null
    : userId;

  const where: Record<string, unknown> = {};
  if (scopedUserId) where.userId = scopedUserId;
  if (month && MONTH_RX.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    where.OR = [
      { expectedCloseDate: { gte: start, lte: end } },
      { closedDate: { gte: start, lte: end } },
    ];
  }

  const rows = await prisma.leadPulsePipeline.findMany({
    where,
    orderBy: [
      { status: "asc" }, // open first (alphabetical: closed_won, lost, open — flip in client)
      { expectedCloseDate: "asc" },
    ],
    include: {
      service: { select: { id: true, name: true } },
      source: { select: { id: true, code: true, label: true } },
      party: { select: { id: true, name: true } },
      user: { select: { id: true, username: true } },
    },
  });

  return NextResponse.json({
    rows: rows.map((p) => ({
      ...serialize(p),
      service: p.service,
      source: p.source,
      party: p.party,
      user: p.user,
    })),
  });
}

export async function POST(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;

  // Owner: caller unless supervisor explicitly chose another userId.
  let ownerId = userId;
  if (d.userId && d.userId !== userId) {
    if (!access.canSupervise) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    ownerId = d.userId;
  } else {
    if (access.role !== "l2" && !access.canSupervise) {
      return NextResponse.json({ error: "forbidden_l2_only" }, { status: 403 });
    }
  }

  // The owner must be an L2 BDE.
  const ownerRole = await prisma.leadPulseRole.findUnique({ where: { userId: ownerId } });
  if (!ownerRole || ownerRole.role !== "l2") {
    return NextResponse.json({ error: "owner_not_l2" }, { status: 400 });
  }

  // Cheap sanity checks on the FKs so we return a clean error code instead
  // of a Prisma P2003 in the API consumer's face.
  const [svc, src] = await Promise.all([
    prisma.service.findUnique({ where: { id: d.serviceId }, select: { id: true } }),
    prisma.leadPulseSource.findUnique({ where: { id: d.sourceId }, select: { id: true } }),
  ]);
  if (!svc) return NextResponse.json({ error: "service_not_found" }, { status: 400 });
  if (!src) return NextResponse.json({ error: "source_not_found" }, { status: 400 });

  const created = await prisma.leadPulsePipeline.create({
    data: {
      userId: ownerId,
      candidateName: d.candidateName,
      candidatePhone: d.candidatePhone?.trim() || null,
      serviceId: d.serviceId,
      sourceId: d.sourceId,
      expectedCloseDate: new Date(`${d.expectedCloseDate}T00:00:00.000Z`),
      expectedFirstInstallment: d.expectedFirstInstallment,
      notes: d.notes?.trim() || null,
      status: "open",
    },
    include: {
      service: { select: { id: true, name: true } },
      source: { select: { id: true, code: true, label: true } },
      party: { select: { id: true, name: true } },
      user: { select: { id: true, username: true } },
    },
  });

  await prisma.leadPulseAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "pipeline_created",
      targetId: created.id,
      metadata: {
        ownerId,
        candidateName: created.candidateName,
        serviceId: created.serviceId,
        sourceId: created.sourceId,
        expectedCloseDate: d.expectedCloseDate,
        expectedFirstInstallment: d.expectedFirstInstallment,
      },
    },
  });

  return NextResponse.json({ row: { ...serialize(created), service: created.service, source: created.source, party: created.party, user: created.user } });
}
