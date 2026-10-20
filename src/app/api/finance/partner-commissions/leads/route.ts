import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { leadSearchClauses } from "@/lib/crm-leads";
import { leadHint } from "@/lib/partner-commissions/lead-hint";
import { requireAccess } from "@/lib/partner-commissions/server";

export const dynamic = "force-dynamic";

/**
 * Lead search for linking an enrollment to its CRM lead — by name, phone or
 * email, with the same matching as the CRM Leads list (any phone format; an "@"
 * searches email only). Top 8, contact details masked in the hint.
 */
export const GET = withApiHandler(async (req: Request) => {
  await requireAccess("any");
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 2) return NextResponse.json({ leads: [] });
  const leads = await prisma.lead.findMany({
    where: { OR: leadSearchClauses(q) },
    orderBy: { lastActivityAt: "desc" },
    take: 8,
    select: { id: true, candidateName: true, phone: true, altPhone: true, email: true, service: { select: { name: true } } },
  });
  return NextResponse.json({
    leads: leads.map((l) => ({
      id: l.id,
      name: l.candidateName,
      hint: leadHint({ service: l.service?.name, phone: l.phone, altPhone: l.altPhone, email: l.email }),
    })),
  });
});
