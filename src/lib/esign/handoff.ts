import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mintToken } from "@/lib/hiring/envelope";
import { recordEsignEvent } from "@/lib/esign/events";
import { notifyInternalSigner, notifySigner, type ChannelResult } from "@/lib/esign/notify";
import { activeSigners } from "@/lib/esign/requests";

/**
 * Handing an agreement to the next signer(s) — when it is first sent, and
 * after each signature.
 *
 * Two kinds of signer:
 * - DESMA staff (`userId` set) sign inside DesGro, logged in. No link token is
 *   minted for them; they get an email pointing at the agreement in DesGro.
 * - Everyone else (the client) gets a one-time link by email and WhatsApp and
 *   confirms a code before signing.
 */

export type Activated = { signerId: string; raw: string | null };
export type SignerDelivery = { signerId: string; name: string; role: string; results: ChannelResult[] };

export function signingLink(baseUrl: string, rawToken: string): string {
  return `${baseUrl.replace(/\/$/, "")}/sign/${rawToken}`;
}

export function internalSigningLink(baseUrl: string, requestId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/operations/agreements/${requestId}/sign`;
}

/**
 * Mark whoever's turn it is as "sent", minting link tokens for external
 * signers. Call inside the transaction that changes the signers.
 */
export async function activateSigners(
  tx: Prisma.TransactionClient,
  signers: Array<{ id: string; userId: string | null; signOrder: number; status: string }>,
  expiresAt: Date,
): Promise<Activated[]> {
  const out: Activated[] = [];
  for (const s of activeSigners(signers)) {
    if (s.status !== "waiting") continue;
    if (s.userId) {
      await tx.esignSigner.update({ where: { id: s.id }, data: { status: "sent", tokenHash: null, tokenExpiresAt: expiresAt } });
      out.push({ signerId: s.id, raw: null });
    } else {
      const { raw, hash } = mintToken();
      await tx.esignSigner.update({ where: { id: s.id }, data: { status: "sent", tokenHash: hash, tokenExpiresAt: expiresAt } });
      out.push({ signerId: s.id, raw });
    }
  }
  return out;
}

/** Tell each newly activated signer, and log what reached them. Call after the transaction commits. */
export async function deliverActivated(requestId: string, activated: Activated[], ctx: { baseUrl: string; userId: string | null }): Promise<SignerDelivery[]> {
  if (!activated.length) return [];
  const req = await prisma.esignRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { signers: true, lead: { select: { candidateName: true } }, templateVersion: { include: { template: true } } },
  });
  const template = req.templateVersion!.template;
  const out: SignerDelivery[] = [];
  for (const { signerId, raw } of activated) {
    const signer = req.signers.find((s) => s.id === signerId)!;
    const results = raw
      ? await notifySigner({
          request: { id: req.id, reference: req.reference, expiresAt: req.expiresAt!, message: req.message, leadId: req.leadId },
          template,
          signer,
          link: signingLink(ctx.baseUrl, raw),
          token: raw,
          actorId: ctx.userId,
        })
      : await notifyInternalSigner({
          request: { id: req.id, reference: req.reference, expiresAt: req.expiresAt! },
          template,
          signer,
          clientName: req.lead?.candidateName ?? req.reference,
          link: internalSigningLink(ctx.baseUrl, req.id),
        });
    await recordEsignEvent(prisma, {
      requestId: req.id,
      signerId,
      action: "notified",
      actor: "system",
      meta: { results: results as unknown as Prisma.InputJsonValue, inApp: !raw },
    });
    out.push({ signerId, name: signer.name, role: signer.role, results });
  }
  return out;
}
