import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit } from "@/lib/hiring/audit";
import {
  getHiringSender,
  setHiringSender,
  getHiringSmtp,
  setHiringSmtp,
  isValidSenderAddress,
  HIRING_FROM_ADDR_KEY,
} from "@/lib/hiring/email";
import { resetTransport } from "@/lib/mailer";

export const dynamic = "force-dynamic";

const schema = z.object({
  address: z.string().trim().max(200),
  name: z.string().trim().max(100).optional(),
  /** Hiring's own mailbox login. Optional — blank keeps the shared account. */
  smtpUser: z.string().trim().max(200).optional(),
  // Not trimmed: Google shows app passwords in spaced groups of four.
  smtpPass: z.string().max(200).optional(),
});

/** PUT /api/hiring/email-sender — set or clear the candidate-facing From address. */
export const PUT = withApiHandler(async (req: Request) => {
  const access = await requireHiring("team:manage");
  const { address, name, smtpUser, smtpPass } = schema.parse(await req.json());

  if (address && !isValidSenderAddress(address)) {
    throw badRequest("That does not look like an email address.", "bad_sender");
  }
  if (smtpUser && !isValidSenderAddress(smtpUser)) {
    throw badRequest("The mailbox login must be an email address.", "bad_smtp_user");
  }

  const before = await getHiringSender();
  const beforeSmtp = await getHiringSmtp();
  await setHiringSender(address || null, name ?? null, access.userId);

  if (smtpUser !== undefined) {
    await setHiringSmtp(smtpUser || null, smtpPass, access.userId);
    // The pooled transport is keyed on the credentials it was built with.
    resetTransport();
  }

  await recordHiringAudit({
    actorId: access.userId,
    action: address ? "hiring.sender_set" : "hiring.sender_cleared",
    entityType: "AppSetting",
    entityId: HIRING_FROM_ADDR_KEY,
    // Never the password, in the audit log or anywhere else it could be read
    // back — only whether one is set.
    before: { address: before.address, name: before.name, smtpUser: beforeSmtp?.user ?? null },
    after: { address: address || null, name: name ?? null, smtpUser: smtpUser || null },
  });

  return NextResponse.json({ address: address || null, name: name ?? null });
});
