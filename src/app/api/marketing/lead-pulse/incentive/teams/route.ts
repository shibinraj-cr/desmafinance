import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { todayIst } from "@/lib/lead-pulse-dates";
import { doubleBookedMember, isIncentiveMonthClosed, quarterOf } from "@/lib/crm-incentive";

export const dynamic = "force-dynamic";

/**
 * Teams for the L2 team incentive, from the target sheet's "Teams" tab.
 * Supervisor-only.
 *
 *   POST  { name }                   — create a team.
 *   PATCH { id, name?, active? }     — rename, retire or restore a team.
 *   PUT   { year, month, teams }     — save one month: every team's members
 *         and its monthly and quarterly target + pool. Replaces the month's
 *         whole membership, so a BDE moves team by appearing under another.
 *         A closed (past) month is admin-only.
 */
const Name = z.string().trim().min(1).max(60);

async function supervisor() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return { ok: false, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return { ok: false, res: NextResponse.json({ error: "forbidden_supervisor_only" }, { status: 403 }) } as const;
  }
  return { ok: true, userId, access } as const;
}

async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  const hit = await prisma.leadPulseTeam.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  return hit !== null;
}

export async function POST(req: NextRequest) {
  const who = await supervisor();
  if (!who.ok) return who.res;
  const parsed = z.object({ name: Name }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  const { name } = parsed.data;
  if (await nameTaken(name)) {
    return NextResponse.json({ error: "name_taken", message: `A team called "${name}" already exists.` }, { status: 409 });
  }
  const team = await prisma.leadPulseTeam.create({ data: { name }, select: { id: true, name: true, active: true } });
  await prisma.leadPulseAuditLog.create({
    data: { actorUserId: who.userId, eventType: "entry_edited", targetId: team.id, metadata: { kind: "incentive_team_created", name } },
  });
  return NextResponse.json({ ok: true, team });
}

export async function PATCH(req: NextRequest) {
  const who = await supervisor();
  if (!who.ok) return who.res;
  const parsed = z
    .object({ id: z.string().min(1), name: Name.optional(), active: z.boolean().optional() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  const { id, name, active } = parsed.data;

  const existing = await prisma.leadPulseTeam.findUnique({ where: { id }, select: { id: true, name: true, active: true } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (name !== undefined && (await nameTaken(name, id))) {
    return NextResponse.json({ error: "name_taken", message: `A team called "${name}" already exists.` }, { status: 409 });
  }
  // Retiring keeps the team's history; it only hides it from months to come.
  // A team still holding members in the current or a later month must be
  // emptied first, or those BDEs would sit in a team nobody can see.
  if (active === false) {
    const [y, m] = todayIst().split("-").map(Number);
    const ahead = await prisma.leadPulseTeamMember.count({
      where: { teamId: id, OR: [{ year: { gt: y } }, { year: y, month: { gte: m } }] },
    });
    if (ahead > 0) {
      return NextResponse.json(
        { error: "team_has_members", message: "Move this team's BDEs out for this month and later months before retiring it." },
        { status: 409 },
      );
    }
  }

  const team = await prisma.leadPulseTeam.update({
    where: { id },
    data: { ...(name !== undefined ? { name } : {}), ...(active !== undefined ? { active } : {}) },
    select: { id: true, name: true, active: true },
  });
  await prisma.leadPulseAuditLog.create({
    data: {
      actorUserId: who.userId,
      eventType: "entry_edited",
      targetId: id,
      metadata: { kind: "incentive_team_updated", previous: { name: existing.name, active: existing.active }, next: team },
    },
  });
  return NextResponse.json({ ok: true, team });
}

const TargetPool = z.object({
  target: z.number().int().min(1).max(100_000),
  pool: z.number().int().min(0).max(100_000_000),
});

const MonthSchema = z.object({
  year: z.number().int().min(2024).max(2100),
  month: z.number().int().min(1).max(12),
  teams: z
    .array(
      z.object({
        teamId: z.string().min(1),
        userIds: z.array(z.string().min(1)).max(200),
        month: TargetPool.nullable(),
        quarter: TargetPool.nullable(),
      }),
    )
    .max(100),
});

export async function PUT(req: NextRequest) {
  const who = await supervisor();
  if (!who.ok) return who.res;
  const parsed = MonthSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  const { year, month, teams } = parsed.data;
  const quarter = quarterOf(month);

  if (isIncentiveMonthClosed(year, month, todayIst()) && !who.access.desfinAdmin) {
    return NextResponse.json({ error: "month_closed", message: "This month is closed. Only an admin can change it." }, { status: 403 });
  }
  if (new Set(teams.map((t) => t.teamId)).size !== teams.length) {
    return NextResponse.json({ error: "duplicate_team" }, { status: 400 });
  }
  const twice = doubleBookedMember(teams);
  if (twice) {
    return NextResponse.json({ error: "member_in_two_teams", userId: twice, message: "A BDE can be in only one team a month." }, { status: 400 });
  }

  const teamIds = teams.map((t) => t.teamId);
  const found = teamIds.length
    ? await prisma.leadPulseTeam.findMany({ where: { id: { in: teamIds } }, select: { id: true } })
    : [];
  if (found.length !== teamIds.length) return NextResponse.json({ error: "team_not_found" }, { status: 400 });

  // Members must be active L2 BDEs — except someone already in a team this
  // month, who stays even after leaving (their enrolments still count).
  const userIds = teams.flatMap((t) => t.userIds);
  if (userIds.length) {
    const [activeL2, current] = await Promise.all([
      prisma.leadPulseRole.findMany({ where: { userId: { in: userIds }, role: "l2", active: true }, select: { userId: true } }),
      prisma.leadPulseTeamMember.findMany({ where: { year, month, userId: { in: userIds } }, select: { userId: true } }),
    ]);
    const allowed = new Set([...activeL2.map((r) => r.userId), ...current.map((r) => r.userId)]);
    if (userIds.some((id) => !allowed.has(id))) {
      return NextResponse.json({ error: "not_l2_bde", message: "Only active L2 BDEs can join a team." }, { status: 400 });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.leadPulseTeamMember.deleteMany({ where: { year, month } });
    const rows = teams.flatMap((t) => t.userIds.map((u) => ({ teamId: t.teamId, userId: u, year, month })));
    if (rows.length) await tx.leadPulseTeamMember.createMany({ data: rows });

    for (const t of teams) {
      for (const [periodType, period, value] of [
        ["month", month, t.month],
        ["quarter", quarter, t.quarter],
      ] as const) {
        const key = { teamId: t.teamId, year, periodType, period };
        if (value === null) {
          await tx.leadPulseTeamTarget.deleteMany({ where: key });
        } else {
          await tx.leadPulseTeamTarget.upsert({
            where: { teamId_year_periodType_period: key },
            create: { ...key, ...value, updatedById: who.userId },
            update: { ...value, updatedById: who.userId },
          });
        }
      }
    }

    await tx.leadPulseAuditLog.create({
      data: {
        actorUserId: who.userId,
        eventType: "entry_edited",
        metadata: {
          kind: "incentive_teams_update",
          year,
          month,
          teams: teams.map((t) => ({ teamId: t.teamId, members: t.userIds.length, month: t.month, quarter: t.quarter })),
        },
      },
    });
  });

  return NextResponse.json({ ok: true });
}
