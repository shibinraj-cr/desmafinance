import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { forbidden, unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { leadSearchClauses } from "@/lib/crm-leads";
import { leadHint } from "@/lib/partner-commissions/lead-hint";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/leads/search?q= — a short lead lookup for pickers (the
 * "Referred by" candidate on a referral). Same matching as the Leads list —
 * name, any phone format, or email — top 8, with the contact masked in the
 * hint: enough to tell two same-named candidates apart.
 */
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 2) return NextResponse.json({ leads: [] });
  const leads = await prisma.lead.findMany({
    where: { OR: leadSearchClauses(q) },
    orderBy: { lastActivityAt: "desc" },
    take: 8,
    select: {
      id: true,
      candidateName: true,
      phone: true,
      altPhone: true,
      email: true,
      service: { select: { name: true } },
      status: { select: { label: true } },
    },
  });
  return NextResponse.json({
    leads: leads.map((l) => ({
      id: l.id,
      name: l.candidateName,
      hint: [l.status.label, leadHint({ service: l.service?.name, phone: l.phone, altPhone: l.altPhone, email: l.email })]
        .filter(Boolean)
        .join(" · "),
    })),
  });
});
