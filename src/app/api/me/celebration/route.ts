import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { celebrationsToday } from "@/lib/celebrations";

/**
 * The signed-in user's own celebration state.
 *
 *  POST  — record that they have been shown this year's greeting, so it never
 *          fires twice (a second device, a re-login, a hard refresh).
 *  PATCH — set their opt-out. Theirs to set, not HR's: a date of birth is given
 *          to HR for payroll, not for publication.
 */

const AckSchema = z.object({
  kind: z.enum(["birthday", "anniversary"]),
  years: z.number().int().min(0).max(80).nullable(),
});

const OptOutSchema = z.object({ celebrationOptOut: z.boolean() });

export async function POST(req: Request) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = AckSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }

  // Re-derive rather than trusting the body: the client tells us *which*
  // greeting it showed, but whether that celebration is real today is decided
  // here, so a hand-rolled POST cannot plant rows for arbitrary people or dates.
  const todays = await celebrationsToday();
  const mine = todays.find((c) => c.userId === userId && c.kind === parsed.data.kind);
  if (!mine) return NextResponse.json({ error: "no celebration today" }, { status: 409 });

  await prisma.hrCelebration
    .create({
      data: {
        employeeId: mine.employeeId,
        kind: mine.kind,
        year: mine.year,
        years: mine.years,
      },
    })
    .catch(() => {
      // Unique violation = already recorded, which is exactly the state we
      // wanted. Anything else costs at most one repeat greeting.
    });

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = OptOutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }

  const employee = await prisma.employee.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!employee) {
    return NextResponse.json(
      { error: "Your login is not linked to an employee record yet — ask HR to link it." },
      { status: 404 },
    );
  }

  await prisma.employee.update({
    where: { id: employee.id },
    data: { celebrationOptOut: parsed.data.celebrationOptOut },
  });

  return NextResponse.json({ ok: true, celebrationOptOut: parsed.data.celebrationOptOut });
}
