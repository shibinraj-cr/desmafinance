import { NextRequest, NextResponse } from "next/server";
import { submitUpdate, submitDelete } from "@/lib/approval";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { RawTxFieldsSchema, buildValidatedProposed } from "@/lib/finance-tx-validation";

export const dynamic = "force-dynamic";

// Transaction editing lives on the Daily Tracker page — gate the API by it.
const PAGE = "/finance/daily-tracker";

const MAX_BODY_BYTES = 10_000;

// `month` is derived from `date` server-side; enum/master/amount/counterparty
// semantics live in buildValidatedProposed, shared with create/resubmit/draft.
const TxPatchSchema = RawTxFieldsSchema;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canSeePage(perms, PAGE)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Single server-authoritative validation shared with create/resubmit/draft.
  const built = await buildValidatedProposed(parsed.data);
  if ("error" in built) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }

  const result = await submitUpdate({ txId: params.id, data: built.proposed, userId, perms });
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
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canSeePage(perms, PAGE)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
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
