import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { submitCreate } from "@/lib/approval";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TYPES, MONTHS } from "@/lib/catalog";
import { RawTxFieldsSchema, buildValidatedProposed } from "@/lib/finance-tx-validation";

export const dynamic = "force-dynamic";

// Transaction entry lives on the Daily Tracker page — gate the API by it.
const PAGE = "/finance/daily-tracker";

const MAX_BODY_BYTES = 10_000;

// `month` is derived from `date` server-side (see finance-tx-validation), so it
// is never accepted from the client. Enum/master/amount/counterparty semantics
// live in buildValidatedProposed so every write path enforces the same rules.
const TxSchema = RawTxFieldsSchema;

const QuerySchema = z.object({
  month: z.enum(MONTHS).optional(),
  type: z.enum(TYPES).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

export async function GET(req: NextRequest) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeePage(perms, PAGE)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const parsedQ = QuerySchema.safeParse({
    month: searchParams.get("month") ?? undefined,
    type: searchParams.get("type") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });
  if (!parsedQ.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }
  const { month, type, limit } = parsedQ.data;

  const items = await prisma.transaction.findMany({
    where: {
      deletedAt: null,
      ...(month ? { month } : {}),
      ...(type ? { type } : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
  return NextResponse.json({
    items: items.map((t) => ({ ...t, amount: Number(t.amount.toString()) })),
  });
}

export async function POST(req: NextRequest) {
  if ((req.headers.get("content-type") ?? "").split(";")[0].trim() !== "application/json") {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  const body = await req.json().catch(() => null);
  const parsed = TxSchema.safeParse(body);
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

  // Single server-authoritative validation (month derived from date, enums,
  // master data, amount, counterparty, EXP/DOM) shared with edit/resubmit/draft.
  const built = await buildValidatedProposed(parsed.data);
  if ("error" in built) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }

  const result = await submitCreate({ data: built.proposed, userId, perms });
  if (result.applied) {
    return NextResponse.json({
      applied: true,
      item: { ...result.transaction, amount: Number(result.transaction.amount.toString()) },
    });
  }
  if ("isDraft" in result && result.isDraft) {
    return NextResponse.json(
      { applied: false, isDraft: true, draftId: result.draft.id },
      { status: 202 },
    );
  }
  return NextResponse.json(
    { applied: false, pendingId: result.pending.id },
    { status: 202 },
  );
}
