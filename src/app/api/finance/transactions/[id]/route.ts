import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { submitUpdate, submitDelete, type TxProposed } from "@/lib/approval";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TYPES, FLOWS, MONTHS, PAYMENT_MODES, flowFor } from "@/lib/catalog";
import { verifyCategorySubItem } from "@/lib/master-data";

const MAX_BODY_BYTES = 10_000;

const TxPatchSchema = z.object({
  date: z
    .string()
    .min(1)
    .refine((s) => !isNaN(Date.parse(s)), "Invalid date"),
  month: z.enum(MONTHS),
  type: z.enum(TYPES),
  category: z.string().min(1).max(120),
  subItem: z.string().min(1).max(160),
  description: z.string().max(500).optional().nullable(),
  paymentMode: z.enum(PAYMENT_MODES),
  amount: z.coerce.number().positive().max(1_000_000_000),
  flow: z.enum(FLOWS).optional(),
  partyId: z.string().min(1).optional().nullable(),
  /** EXP / DOM tag — required for Revenue rows (drives GST liability). */
  expDom: z.enum(["EXP", "DOM"]).optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if ((req.headers.get("content-type") ?? "").split(";")[0].trim() !== "application/json") {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  const body = await req.json().catch(() => null);
  const parsed = TxPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const data = parsed.data;
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const verr = await verifyCategorySubItem(data.category, data.subItem, data.type);
  if (verr) return NextResponse.json({ error: verr }, { status: 400 });

  if (data.type === "Revenue" && data.expDom !== "EXP" && data.expDom !== "DOM") {
    return NextResponse.json({ error: "expDom_required" }, { status: 400 });
  }

  if (data.partyId) {
    const party = await prisma.party.findUnique({
      where: { id: data.partyId },
      select: { id: true, isActive: true, txTypes: true },
    });
    if (!party || !party.isActive) {
      return NextResponse.json({ error: "party_not_found" }, { status: 400 });
    }
    if (party.txTypes !== "Both" && party.txTypes !== data.type) {
      return NextResponse.json({ error: "party_tx_type_mismatch" }, { status: 400 });
    }
  }

  const proposed: TxProposed = {
    date: data.date,
    month: data.month,
    type: data.type,
    category: data.category,
    subItem: data.subItem,
    description: data.description ?? null,
    paymentMode: data.paymentMode,
    amount: data.amount,
    flow: data.flow ?? flowFor(data.type),
    partyId: data.partyId ?? null,
    expDom: data.type === "Revenue" ? (data.expDom ?? null) : null,
  };

  const result = await submitUpdate({ txId: params.id, data: proposed, userId, perms });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  if (result.applied) {
    return NextResponse.json({
      applied: true,
      item: { ...result.transaction, amount: Number(result.transaction.amount.toString()) },
    });
  }
  return NextResponse.json(
    { applied: false, pendingId: result.pending.id },
    { status: 202 },
  );
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await submitDelete({ txId: params.id, userId, perms });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  if (result.applied) {
    return NextResponse.json({ applied: true });
  }
  return NextResponse.json({ applied: false }, { status: 202 });
}
