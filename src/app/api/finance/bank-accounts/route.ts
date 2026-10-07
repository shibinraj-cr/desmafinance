import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { conflict } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import { requireBank } from "@/lib/bank/access";
import { BANK_DEFAULTS } from "@/lib/bank/integration";
import { SUPPORTED_BANKS } from "@/lib/bank/parsers";

export const dynamic = "force-dynamic";

/** GET /api/finance/bank-accounts — configured bank integrations (no secrets). */
export const GET = withApiHandler(async () => {
  await requireBank("view");
  const accounts = await prisma.bankIntegration.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      bankCode: true,
      bankName: true,
      accountName: true,
      accountLastFour: true,
      currency: true,
      automationEnabled: true,
      lastStatementDate: true,
      lastSuccessfulSyncAt: true,
      mailbox: { select: { emailAddress: true } },
    },
  });
  return NextResponse.json({ accounts });
});

const CreateSchema = z.object({
  bankCode: z.string().refine((c) => SUPPORTED_BANKS.includes(c), "Unsupported bank"),
  accountName: z.string().trim().min(1).max(80),
  accountLastFour: z.string().regex(/^\d{4}$/, "Last four digits"),
  emailRecipient: z.string().trim().email().max(200).optional().or(z.literal("")),
});

/** POST /api/finance/bank-accounts — add an account, prefilled with the bank's statement e-mail defaults. */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("manage");
  const body = CreateSchema.parse(await req.json());
  const d = BANK_DEFAULTS[body.bankCode];
  const exists = await prisma.bankIntegration.findUnique({
    where: { bankCode_accountLastFour: { bankCode: body.bankCode, accountLastFour: body.accountLastFour } },
    select: { id: true },
  });
  if (exists) throw conflict("That account is already configured");
  const created = await prisma.bankIntegration.create({
    data: {
      bankCode: body.bankCode,
      bankName: d.bankName,
      accountName: body.accountName,
      accountLastFour: body.accountLastFour,
      emailSender: d.emailSender,
      emailRecipient: body.emailRecipient || null,
      emailSubjectPattern: d.emailSubjectPattern,
      passwordSecretRef: `env:${d.passwordEnvVar}`,
      createdById: userId,
      updatedById: userId,
    },
    select: { id: true },
  });
  await recordAudit({
    entityType: "BankIntegration",
    entityId: created.id,
    action: "CREATE",
    userId,
    changes: { bankCode: body.bankCode, accountLastFour: body.accountLastFour },
  });
  return NextResponse.json({ id: created.id }, { status: 201 });
});
