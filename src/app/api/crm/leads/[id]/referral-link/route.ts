import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { siteBaseUrl } from "@/lib/site-url";
import { getOrCreateReferralLink } from "@/lib/crm-referral";
import { referralUrl } from "@/lib/crm-referral-link";

export const dynamic = "force-dynamic";

// POST /api/crm/leads/[id]/referral-link — the lead's shareable link, made on
// first ask. Anyone who can open the lead may copy it: a consultant shares it
// with the candidate by hand, whoever owns the lead.
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const lead = await prisma.lead.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!lead) throw notFound();

  const link = await getOrCreateReferralLink(lead.id, userId);
  return NextResponse.json({
    link: { code: link.code, url: referralUrl(siteBaseUrl(req), link.code), active: link.active },
  });
});

// PATCH /api/crm/leads/[id]/referral-link — switch the link off or back on.
// Whoever hands out leads decides: a switched-off link still takes enquiries,
// but credits nobody, so this is how a misused link is stopped.
const PatchSchema = z.object({ active: z.boolean() });

export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canAssign) throw forbidden();

  const { active } = PatchSchema.parse(await req.json().catch(() => null));
  const existing = await prisma.crmReferralLink.findUnique({ where: { referrerLeadId: params.id }, select: { id: true } });
  if (!existing) throw notFound();

  const link = await prisma.crmReferralLink.update({ where: { id: existing.id }, data: { active } });
  return NextResponse.json({
    link: { code: link.code, url: referralUrl(siteBaseUrl(req), link.code), active: link.active },
  });
});
