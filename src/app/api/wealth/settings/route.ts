import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { toPrismaDate, todayIst } from "@/lib/lead-pulse-dates";
import { requireWealthOwner } from "@/lib/wealth-access";
import { SettingsSchema } from "@/lib/wealth-schemas";

export const dynamic = "force-dynamic";

/**
 * Per-owner preferences. The gold rate lives here rather than on each piece,
 * which is what makes re-pricing the whole vault a single edit.
 */
export const PATCH = withApiHandler(async (req: Request) => {
  const ownerUserId = await requireWealthOwner();
  const body = SettingsSchema.parse(await req.json());

  const data: Record<string, unknown> = {};
  if (body.goldRatePerGram !== undefined) {
    data.goldRatePerGram = body.goldRatePerGram;
    // A new rate without an explicit date is a rate quoted today.
    data.goldRateAsOn = toPrismaDate(body.goldRateAsOn ?? todayIst());
  } else if (body.goldRateAsOn !== undefined) {
    data.goldRateAsOn = body.goldRateAsOn ? toPrismaDate(body.goldRateAsOn) : null;
  }
  if (body.hideBusinessScope !== undefined) data.hideBusinessScope = body.hideBusinessScope;
  if (body.remindersEnabled !== undefined) data.remindersEnabled = body.remindersEnabled;

  const row = await prisma.wealthSetting.upsert({
    where: { ownerUserId },
    create: { ownerUserId, ...data },
    update: data,
  });

  return NextResponse.json({ ok: true, goldRatePerGram: row.goldRatePerGram.toString() });
});
