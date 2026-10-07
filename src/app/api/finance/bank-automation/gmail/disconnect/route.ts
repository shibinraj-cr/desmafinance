import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { requireBank } from "@/lib/bank/access";
import { logEvent } from "@/lib/bank/events";
import { revokeGoogleToken } from "@/lib/bank/gmail";
import { unseal } from "@/lib/bank/secrets";

export const dynamic = "force-dynamic";

const Schema = z.object({ integrationId: z.string().min(1) });

/**
 * POST …/gmail/disconnect — detach the mailbox. The Google grant is revoked
 * and the sealed token deleted once no other integration uses that mailbox.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("manage");
  const { integrationId } = Schema.parse(await req.json());
  const i = await prisma.bankIntegration.findUniqueOrThrow({ where: { id: integrationId }, select: { mailboxConnectionId: true } });
  if (!i.mailboxConnectionId) return NextResponse.json({ ok: true });
  await prisma.bankIntegration.update({ where: { id: integrationId }, data: { mailboxConnectionId: null, updatedById: userId } });
  const stillUsed = await prisma.bankIntegration.count({ where: { mailboxConnectionId: i.mailboxConnectionId } });
  if (!stillUsed) {
    const m = await prisma.bankMailboxConnection.findUnique({ where: { id: i.mailboxConnectionId } });
    if (m) {
      try {
        await revokeGoogleToken(unseal(m.refreshTokenEnc, "gmail-refresh-token"));
      } catch {
        /* undecryptable — nothing to revoke */
      }
      await prisma.bankMailboxConnection.delete({ where: { id: m.id } });
    }
  }
  await recordAudit({ entityType: "BankIntegration", entityId: integrationId, action: "UPDATE", userId, changes: { mailbox: "disconnected" } });
  await logEvent({ integrationId, step: "gmail", message: "Gmail mailbox disconnected", userId });
  return NextResponse.json({ ok: true });
});
