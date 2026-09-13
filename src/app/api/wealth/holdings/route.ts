import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { toPrismaDate, todayIst } from "@/lib/lead-pulse-dates";
import { requireWealthOwner } from "@/lib/wealth-access";
import { HoldingCreateSchema } from "@/lib/wealth-schemas";
import { encryptSecret, isSecretVaultConfigured } from "@/lib/wealth-crypto";
import { syncReminders } from "@/lib/wealth";

export const dynamic = "force-dynamic";

/**
 * Create a holding. Optionally takes an opening valuation so adding one is a
 * single step rather than "create, then value".
 *
 * The password, if given, is encrypted here and never stored in clear. With no
 * WEALTH_SECRET_KEY configured the request is refused rather than silently
 * dropping the password or writing it as plaintext.
 */
export const POST = withApiHandler(async (req: Request) => {
  const ownerUserId = await requireWealthOwner();
  const body = HoldingCreateSchema.parse(await req.json());

  const secret = body.portalPassword?.trim();
  if (secret && !isSecretVaultConfigured()) {
    throw badRequest(
      "Portal passwords can't be stored until WEALTH_SECRET_KEY is set on the server.",
      "secret_vault_unconfigured",
    );
  }

  const holding = await prisma.wealthHolding.create({
    data: {
      ownerUserId,
      name: body.name,
      assetClass: body.assetClass,
      scope: body.scope,
      holderLabel: body.holderLabel,
      institution: body.institution ?? null,
      policyNo: body.policyNo ?? null,
      investedAmount: body.investedAmount ?? null,
      contributionAmount: body.contributionAmount ?? null,
      frequency: body.frequency,
      dueDayOfMonth: body.dueDayOfMonth ?? null,
      renewalOn: body.renewalOn ? toPrismaDate(body.renewalOn) : null,
      termYears: body.termYears ?? null,
      sumAssured: body.sumAssured ?? null,
      reminderLeadDays: body.reminderLeadDays,
      portalUrl: body.portalUrl || null,
      portalUsername: body.portalUsername || null,
      portalSecretEnc: secret ? encryptSecret(secret) : null,
      notes: body.notes ?? null,
      valuations:
        body.value != null
          ? {
              create: {
                value: body.value,
                asOn: toPrismaDate(body.valuedOn ?? todayIst()),
                source: "manual",
                createdById: ownerUserId,
              },
            }
          : undefined,
    },
    select: { id: true },
  });

  // A new schedule means new dated instalments; generating them now keeps the
  // reminder rail correct without waiting for the nightly cron.
  await syncReminders(ownerUserId);

  return NextResponse.json({ ok: true, id: holding.id }, { status: 201 });
});
