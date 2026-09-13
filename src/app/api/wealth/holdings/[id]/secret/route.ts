import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { logger } from "@/lib/logger";
import { requireWealthOwner } from "@/lib/wealth-access";
import { decryptSecret, isSecretVaultConfigured } from "@/lib/wealth-crypto";

export const dynamic = "force-dynamic";

/**
 * Reveal one stored portal password.
 *
 * Deliberately a POST with no cacheable surface: a GET would put a request for
 * a secret into browser history, proxy logs and the Next.js router cache. The
 * response carries no-store, one holding at a time, and every read writes a
 * WealthSecretReveal row — an encrypted field nobody can audit is only half a
 * control.
 *
 * The reveal is owner-scoped, not admin-scoped: a second admin asking for this
 * holding gets a 404, because the row is not theirs.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const ownerUserId = await requireWealthOwner();

  if (!isSecretVaultConfigured()) {
    throw badRequest(
      "Portal passwords can't be read until WEALTH_SECRET_KEY is set on the server.",
      "secret_vault_unconfigured",
    );
  }

  const holding = await prisma.wealthHolding.findFirst({
    where: { id: params.id, ownerUserId },
    select: { id: true, name: true, portalSecretEnc: true },
  });
  if (!holding) throw notFound();
  if (!holding.portalSecretEnc) {
    throw badRequest("No password is stored for this holding.", "no_secret_stored");
  }

  let password: string;
  try {
    password = decryptSecret(holding.portalSecretEnc);
  } catch {
    // Almost always a rotated or mistyped key. Say so plainly rather than
    // returning a 500 that looks like the app is broken.
    throw badRequest(
      "That password can't be decrypted — WEALTH_SECRET_KEY has changed since it was saved. Re-enter the password to store it under the current key.",
      "secret_undecryptable",
    );
  }

  await prisma.wealthSecretReveal
    .create({
      data: {
        holdingId: holding.id,
        actorUserId: ownerUserId,
        ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      },
    })
    .catch((e) => logger.error("wealth_secret_reveal_audit_failed", { holdingId: holding.id, error: String(e) }));

  return NextResponse.json(
    { ok: true, password },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" } },
  );
});

/** The reveal history for one holding — who opened it, and when. */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const ownerUserId = await requireWealthOwner();
  const holding = await prisma.wealthHolding.findFirst({
    where: { id: params.id, ownerUserId },
    select: { id: true },
  });
  if (!holding) throw notFound();

  const reveals = await prisma.wealthSecretReveal.findMany({
    where: { holdingId: params.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, createdAt: true },
  });
  return NextResponse.json({ ok: true, reveals }, { headers: { "Cache-Control": "no-store" } });
});
