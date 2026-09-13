import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { toPrismaDate, todayIst } from "@/lib/lead-pulse-dates";
import { requireWealthOwner } from "@/lib/wealth-access";
import { HoldingUpdateSchema } from "@/lib/wealth-schemas";
import { encryptSecret, isSecretVaultConfigured } from "@/lib/wealth-crypto";
import { syncReminders } from "@/lib/wealth";

export const dynamic = "force-dynamic";

/** Load a holding, proving it belongs to the caller. 404 (not 403) on someone
 *  else's row: the existence of another owner's holding is itself private. */
async function ownedHolding(id: string, ownerUserId: string) {
  const row = await prisma.wealthHolding.findFirst({
    where: { id, ownerUserId },
    select: { id: true },
  });
  if (!row) throw notFound();
  return row;
}

/**
 * Update a holding. Two things are deliberately not plain field writes:
 *
 *  - `value`/`valuedOn` append a WealthValuation rather than overwriting one,
 *    so the corpus keeps its history (re-saving the same day corrects it);
 *  - `portalPassword` is encrypted, and an empty string clears the stored
 *    password instead of storing an encrypted blank.
 */
export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const ownerUserId = await requireWealthOwner();
  await ownedHolding(params.id, ownerUserId);
  const body = HoldingUpdateSchema.parse(await req.json());

  const data: Record<string, unknown> = {};
  const set = <K extends keyof typeof body>(key: K, column = key as string) => {
    if (body[key] !== undefined) data[column] = body[key];
  };

  set("name");
  set("assetClass");
  set("scope");
  set("holderLabel");
  set("institution");
  set("policyNo");
  set("investedAmount");
  set("contributionAmount");
  set("frequency");
  set("dueDayOfMonth");
  set("termYears");
  set("sumAssured");
  set("reminderLeadDays");
  set("notes");
  if (body.portalUrl !== undefined) data.portalUrl = body.portalUrl || null;
  if (body.portalUsername !== undefined) data.portalUsername = body.portalUsername || null;
  if (body.renewalOn !== undefined) {
    data.renewalOn = body.renewalOn ? toPrismaDate(body.renewalOn) : null;
  }

  if (body.portalPassword !== undefined) {
    const secret = body.portalPassword?.trim() ?? "";
    if (secret === "") {
      data.portalSecretEnc = null;
    } else {
      if (!isSecretVaultConfigured()) {
        throw badRequest(
          "Portal passwords can't be stored until WEALTH_SECRET_KEY is set on the server.",
          "secret_vault_unconfigured",
        );
      }
      data.portalSecretEnc = encryptSecret(secret);
    }
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.wealthHolding.update({ where: { id: params.id }, data });
    }
    if (body.value != null) {
      const asOn = toPrismaDate(body.valuedOn ?? todayIst());
      await tx.wealthValuation.upsert({
        where: { holdingId_asOn: { holdingId: params.id, asOn } },
        create: { holdingId: params.id, asOn, value: body.value, source: "manual", createdById: ownerUserId },
        update: { value: body.value, createdById: ownerUserId },
      });
    }
  });

  // The schedule may have moved; top up the dated instalments.
  await syncReminders(ownerUserId);

  return NextResponse.json({ ok: true });
});

/**
 * Archive a holding. Soft delete, matching how Finance handles corrections —
 * the valuation history and any paid reminders stay auditable. Open reminders
 * for it are cleared so the attention rail does not keep nagging about
 * something that is no longer on the desk.
 */
export const DELETE = withApiHandler(
  async (_req: Request, { params }: { params: { id: string } }) => {
    const ownerUserId = await requireWealthOwner();
    await ownedHolding(params.id, ownerUserId);

    await prisma.$transaction([
      prisma.wealthHolding.update({
        where: { id: params.id },
        data: { archivedAt: new Date() },
      }),
      prisma.wealthReminder.deleteMany({ where: { holdingId: params.id, status: "open" } }),
    ]);

    return NextResponse.json({ ok: true });
  },
);
