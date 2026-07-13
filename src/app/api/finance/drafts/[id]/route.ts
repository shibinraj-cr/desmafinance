import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { discardDraft, updateDraft } from "@/lib/approval";
import { RawTxFieldsSchema, buildValidatedProposed } from "@/lib/finance-tx-validation";

export const dynamic = "force-dynamic";

// Drafts are edited from the My Drafts tab under the Approvals page.
const PAGE = "/finance/approvals";

// `month` is derived from `date` server-side (see finance-tx-validation), and
// category/sub-item/payment-mode are validated against the master there too —
// exactly like a normal transaction create/update.
const PatchSchema = RawTxFieldsSchema;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeePage(perms, PAGE)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", issues: parsed.error.format() }, { status: 400 });
  }
  // Same server-authoritative validation as create/update/resubmit: derived
  // month, type enum, category/sub-item master, payment mode enum, positive
  // amount, flow, counterparty, EXP/DOM.
  const built = await buildValidatedProposed(parsed.data);
  if ("error" in built) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }
  const result = await updateDraft({ draftId: params.id, userId, perms, data: built.proposed });
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
  if (!canSeePage(perms, PAGE)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const result = await discardDraft({ draftId: params.id, userId, perms });
  if ("error" in result && result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 403 },
    );
  }
  return NextResponse.json({ ok: true });
}
