import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { requireBank } from "@/lib/bank/access";
import { logEvent } from "@/lib/bank/events";

export const dynamic = "force-dynamic";

const Schema = z.object({
  integrationId: z.string().min(1),
  automationEnabled: z.boolean().optional(),
  runTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM, 24-hour").optional(),
  lookbackDays: z.number().int().min(1).max(30).optional(),
  alertAfterBusinessDays: z.number().int().min(1).max(15).optional(),
  browserAutomationEnabled: z.boolean().optional(),
  pdfArchiveEnabled: z.boolean().optional(),
  failureScreenshots: z.boolean().optional(),
  sheetSyncEnabled: z.boolean().optional(),
  sheetId: z
    .string()
    .trim()
    .max(200)
    // Accept a pasted Sheet URL and keep just the id.
    .transform((s) => /\/d\/([A-Za-z0-9_-]{20,})/.exec(s)?.[1] ?? s)
    .refine((s) => s === "" || /^[A-Za-z0-9_-]{20,}$/.test(s), "Not a Google Sheet ID or URL")
    .optional(),
  sheetTab: z.string().trim().min(1).max(80).optional(),
  emailRecipient: z.string().trim().email().max(200).optional().or(z.literal("")),
  accountName: z.string().trim().min(1).max(80).optional(),
});

/** PATCH /api/finance/bank-automation/settings — schedule, toggles and Sheets target. */
export const PATCH = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("manage");
  const { integrationId, sheetId, emailRecipient, ...rest } = Schema.parse(await req.json());
  const data = {
    ...rest,
    ...(sheetId !== undefined ? { sheetId: sheetId || null } : {}),
    ...(emailRecipient !== undefined ? { emailRecipient: emailRecipient || null } : {}),
    updatedById: userId,
  };
  await prisma.bankIntegration.update({ where: { id: integrationId }, data });
  await recordAudit({ entityType: "BankIntegration", entityId: integrationId, action: "UPDATE", userId, changes: data });
  if (rest.automationEnabled !== undefined) {
    await logEvent({
      integrationId,
      step: "settings",
      message: rest.automationEnabled ? "Automation resumed" : "Automation paused",
      userId,
    });
  }
  return NextResponse.json({ ok: true });
});
