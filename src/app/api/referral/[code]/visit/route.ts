import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { findReferralLink, recordReferralVisit } from "@/lib/crm-referral";
import { isPreviewOrBot } from "@/lib/crm-referral-link";
import { rateLimit } from "@/lib/hiring/rate-limit";
import { clientIp } from "@/lib/hiring/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/referral/[code]/visit — the PUBLIC page-open beacon.
 *
 * Sent by the referral page's own script once per browser session, so a
 * WhatsApp link preview (which fetches the HTML and runs nothing) is never
 * counted, nor a refresh. Always answers 204: a counter that errors at a
 * stranger tells them nothing useful and costs nothing to keep quiet.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { code: string } }) => {
  const ip = clientIp() ?? "unknown";
  const limited = rateLimit(`referral:visit:${ip}`, 30, 10 * 60_000);
  if (limited.ok && !isPreviewOrBot(req.headers.get("user-agent"))) {
    const link = await findReferralLink(params.code);
    if (link) await recordReferralVisit(link.id);
  }
  return new NextResponse(null, { status: 204 });
});
