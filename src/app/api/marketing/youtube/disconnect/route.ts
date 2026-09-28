import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { revokeToken } from "@/lib/youtube/google";
import { decryptToken } from "@/lib/youtube/token-crypto";
import { canUseYouTubeInsights } from "@/lib/youtube/insights";

export const dynamic = "force-dynamic";

/**
 * POST /api/marketing/youtube/disconnect — revokes Google access and forgets
 * the credential. Synced history (videos, daily views) is kept so past
 * analysis stays readable; reconnecting the same channel resumes the sync.
 */
export const POST = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!canUseYouTubeInsights(perms)) throw forbidden();

  const conns = await prisma.youTubeConnection.findMany();
  for (const c of conns) {
    try {
      await revokeToken(decryptToken(c.refreshTokenEnc));
    } catch {
      // Undecryptable — deleting the row is still the right outcome.
    }
    await prisma.youTubeConnection.delete({ where: { id: c.id } });
    await recordAudit({
      entityType: "YouTubeConnection",
      entityId: c.id,
      action: "DELETE",
      userId,
      changes: { channelId: c.channelId, channelTitle: c.channelTitle },
    });
  }
  return NextResponse.json({ ok: true, disconnected: conns.length });
});
