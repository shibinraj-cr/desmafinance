import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { forbidden, unauthorized } from "@/lib/http-error";
import { canSeePage } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { requireBank } from "@/lib/bank/access";
import { createEntryFromLine } from "@/lib/bank/reconcile-run";

export const dynamic = "force-dynamic";

const Schema = z.object({
  category: z.string().trim().min(1).max(120),
  subItem: z.string().trim().min(1).max(160),
  description: z.string().trim().max(400).optional().nullable(),
  partyId: z.string().min(1).optional().nullable(),
  employeeId: z.string().min(1).optional().nullable(),
  expDom: z.enum(["EXP", "DOM"]).optional().nullable(),
});

/**
 * POST /api/finance/bank-transactions/:id/create-entry — book a ledger entry
 * for a bank line that has none (EPFO, ESIC, TDS, salary, charges, an EMI).
 * Date, amount and bank come from the line; the same validation and approval
 * routing as the Daily Tracker applies.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requireBank("reconcile");
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) throw unauthorized();
  // Posting a ledger entry is the Daily Tracker's job: the same grant applies.
  if (!canSeePage(perms, "/finance/daily-tracker")) throw forbidden("Ledger entries are made by roles with the Daily Tracker");
  const body = Schema.parse(await req.json());
  return NextResponse.json(await createEntryFromLine(params.id, body, userId, perms));
});
