import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { requireBank } from "@/lib/bank/access";
import { logEvent } from "@/lib/bank/events";
import { BANK_DEFAULTS, clearStatementPassword, setStatementPassword } from "@/lib/bank/integration";

export const dynamic = "force-dynamic";

const SetSchema = z.object({ integrationId: z.string().min(1), password: z.string().min(1).max(200) });

/**
 * POST /api/finance/bank-automation/password — replace the statement password.
 * Write-only: it is sealed on arrival and no endpoint ever returns it. The
 * audit entry records THAT it changed, never the value.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("manage");
  const { integrationId, password } = SetSchema.parse(await req.json());
  await setStatementPassword(integrationId, password, userId);
  await recordAudit({ entityType: "BankIntegration", entityId: integrationId, action: "UPDATE", userId, changes: { statementPassword: "updated" } });
  await logEvent({ integrationId, step: "settings", message: "Statement password updated", userId });
  return NextResponse.json({ ok: true });
});

const ClearSchema = z.object({ integrationId: z.string().min(1) });

/** DELETE — forget the stored password and use the deployment secret instead. */
export const DELETE = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("manage");
  const { integrationId } = ClearSchema.parse(await req.json());
  const i = await prisma.bankIntegration.findUniqueOrThrow({ where: { id: integrationId }, select: { bankCode: true } });
  const envName = BANK_DEFAULTS[i.bankCode]?.passwordEnvVar ?? "BANK_STATEMENT_PASSWORD";
  await clearStatementPassword(integrationId, envName, userId);
  await recordAudit({ entityType: "BankIntegration", entityId: integrationId, action: "UPDATE", userId, changes: { statementPassword: `env:${envName}` } });
  await logEvent({ integrationId, step: "settings", message: `Stored password removed — using ${envName}`, userId });
  return NextResponse.json({ ok: true });
});
