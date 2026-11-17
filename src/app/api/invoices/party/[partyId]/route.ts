import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { partyTransactions } from "@/lib/invoices/server";

export const dynamic = "force-dynamic";

/** One candidate's payments and invoices (the Ops project page's card). */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { partyId: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  return NextResponse.json(await partyTransactions(userId, perms, params.partyId));
});
