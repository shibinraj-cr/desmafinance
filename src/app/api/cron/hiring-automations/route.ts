import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { timeTriggerWhere, runAutomation, type Trigger } from "@/lib/hiring/automations";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How many applications one recipe may act on in a single run. */
const PER_RECIPE_CAP = 50;

/**
 * Time-based automations (`time_in_stage`, `no_activity`).
 *
 * Event triggers fire inline where the event happens; these have no event to
 * hang off, so they are swept here. Each recipe is capped per run — a recipe
 * that suddenly matches 4,000 people should message 50 and be seen doing it,
 * not empty the mail quota in one go. The cap is LOGGED, so a truncated sweep
 * is never mistaken for a complete one.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set — automations disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const authed =
    req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const automations = await prisma.hiringAutomation.findMany({ where: { isActive: true } });
  const summary: { name: string; matched: number; ran: number; capped: boolean }[] = [];

  for (const automation of automations) {
    const where = timeTriggerWhere(automation.trigger as unknown as Trigger);
    if (!where) continue;

    const matched = await prisma.hiringApplication.count({ where });
    const applications = await prisma.hiringApplication.findMany({
      where,
      select: { id: true },
      orderBy: { stageEnteredAt: "asc" },
      take: PER_RECIPE_CAP,
    });

    let ran = 0;
    for (const app of applications) {
      const current = await prisma.hiringAutomation.findUnique({ where: { id: automation.id } });
      // A recipe that auto-paused mid-sweep stops immediately.
      if (!current?.isActive) break;
      await runAutomation(current, app.id);
      ran++;
    }

    summary.push({
      name: automation.name,
      matched,
      ran,
      capped: matched > applications.length,
    });
  }

  logger.info("hiring_automations_run", { recipes: summary.length, summary });
  return NextResponse.json({ recipes: summary });
}

export const GET = handle;
export const POST = handle;
