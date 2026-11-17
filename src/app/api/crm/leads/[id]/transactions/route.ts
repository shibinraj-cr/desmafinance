import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { leadTransactions } from "@/lib/invoices/server";

export const dynamic = "force-dynamic";

/** The lead's Transactions tab: package, instalments, payments and invoices of its candidate. */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  return NextResponse.json(await leadTransactions(userId, perms, params.id));
});
