import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { listEnrollments, requireEnrollmentAccess, type EnrollmentTab } from "@/lib/crm-enrollment";

export const dynamic = "force-dynamic";

const TABS: EnrollmentTab[] = ["verify", "sent-back", "not-received", "verified"];

// GET /api/finance/enrollments?tab=verify — one tab of Finance's queue.
export const GET = withApiHandler(async (req: Request) => {
  await requireEnrollmentAccess("view");
  const tab = new URL(req.url).searchParams.get("tab") as EnrollmentTab | null;
  return NextResponse.json(await listEnrollments(tab && TABS.includes(tab) ? tab : "verify"));
});
