import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { discardDraft, updateDraft, type TxProposed } from "@/lib/approval";
import { monthCodeFromDate } from "@/lib/catalog";

export const dynamic = "force-dynamic";

// `month` is derived from `date` server-side (the app stores it as a
// `MMM-YY` code, not `YYYY-MM`), so it isn't accepted from the client.
const PatchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["Revenue", "Expense"]),
  category: z.string().min(1),
  subItem: z.string().min(1),
  description: z.string().nullable().optional(),
  paymentMode: z.string().min(1),
  amount: z.number().positive(),
  flow: z.enum(["Inflow", "Outflow"]),
  partyId: z.string().nullable().optional(),
  expDom: z.enum(["EXP", "DOM"]).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", issues: parsed.error.format() }, { status: 400 });
  }
  const data: TxProposed = {
    date: parsed.data.date,
    month: monthCodeFromDate(new Date(parsed.data.date)),
    type: parsed.data.type,
    category: parsed.data.category,
    subItem: parsed.data.subItem,
    description: parsed.data.description ?? null,
    paymentMode: parsed.data.paymentMode,
    amount: parsed.data.amount,
    flow: parsed.data.flow,
    partyId: parsed.data.partyId ?? null,
    expDom: parsed.data.type === "Revenue" ? (parsed.data.expDom ?? null) : null,
  };
  const result = await updateDraft({ draftId: params.id, userId, perms, data });
  if ("error" in result && result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 403 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await discardDraft({ draftId: params.id, userId, perms });
  if ("error" in result && result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 403 },
    );
  }
  return NextResponse.json({ ok: true });
}
