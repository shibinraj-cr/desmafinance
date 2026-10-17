import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { HttpError, notFound, unauthorized } from "@/lib/http-error";
import { requestOrigin } from "@/lib/esign/events";
import { resolveInternalSeat, type LinkState } from "@/lib/esign/signing";
import { prisma } from "@/lib/prisma";

/** The logged-in DESMA staff member's signer seat on an agreement, open for signing. */
export async function internalSigner(req: Request, requestId: string) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) throw unauthorized();
  const state = await resolveInternalSeat(requestId, userId);
  if (state.kind === "invalid") throw notFound("You are not a signer on this agreement.");
  if (state.kind !== "open") throw new HttpError(409, "This agreement is not waiting for your signature.", state.kind);
  const { request, signer } = state as Extract<LinkState, { request: unknown }>;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, email: true } });
  return { request, signer, userId, user, origin: requestOrigin(req) };
}
