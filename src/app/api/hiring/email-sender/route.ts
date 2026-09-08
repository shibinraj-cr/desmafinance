import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit } from "@/lib/hiring/audit";
import {
  getHiringSender,
  setHiringSender,
  isValidSenderAddress,
  HIRING_FROM_ADDR_KEY,
} from "@/lib/hiring/email";

export const dynamic = "force-dynamic";

const schema = z.object({
  address: z.string().trim().max(200),
  name: z.string().trim().max(100).optional(),
});

/** PUT /api/hiring/email-sender — set or clear the candidate-facing From address. */
export const PUT = withApiHandler(async (req: Request) => {
  const access = await requireHiring("team:manage");
  const { address, name } = schema.parse(await req.json());

  if (address && !isValidSenderAddress(address)) {
    throw badRequest("That does not look like an email address.", "bad_sender");
  }

  const before = await getHiringSender();
  await setHiringSender(address || null, name ?? null, access.userId);

  await recordHiringAudit({
    actorId: access.userId,
    action: address ? "hiring.sender_set" : "hiring.sender_cleared",
    entityType: "AppSetting",
    entityId: HIRING_FROM_ADDR_KEY,
    before: { address: before.address, name: before.name },
    after: { address: address || null, name: name ?? null },
  });

  return NextResponse.json({ address: address || null, name: name ?? null });
});
