import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { getAssignableBdes } from "@/lib/crm-leads";
import { activeQualityReasons } from "@/lib/crm-lead-quality-data";

export const dynamic = "force-dynamic";

// ── GET /api/crm/lead-options — the pick-lists a lead form needs ────────────
// The same masters the web lead page (crm/leads/[id]/page.tsx) loads on the
// server, as JSON for the mobile app — plus the leads list's filter values
// (campaigns, countries, destinations: the same groupBy as crm/leads/page.tsx)
// and the lead-quality reasons. /api/crm/statuses and /sub-statuses are
// CRM-settings only, so a consultant had no way to list the stages they are
// allowed to move a lead to. Read-only, anyone who can view leads; candidate
// parties are deliberately left out (large, and personal data).
export const GET = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const [statuses, subStatuses, sources, services, qualifications, bdes, campaigns, countries, destinations, qualityReasons] = await Promise.all([
    prisma.crmLeadStatus.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
      select: { id: true, code: true, label: true, kind: true, color: true, parked: true },
    }),
    prisma.crmLeadSubStatus.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true, group: true, color: true },
    }),
    prisma.leadPulseSource.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true },
    }),
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.crmQualification.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true },
    }),
    getAssignableBdes(),
    prisma.lead.groupBy({ by: ["campaign"], where: { campaign: { not: null } }, orderBy: { campaign: "asc" } }),
    prisma.lead.groupBy({ by: ["country"], where: { country: { not: null } }, orderBy: { country: "asc" } }),
    prisma.lead.groupBy({ by: ["studyDestination"], where: { studyDestination: { not: null } }, orderBy: { studyDestination: "asc" } }),
    activeQualityReasons(),
  ]);

  return NextResponse.json({
    statuses,
    subStatuses,
    sources,
    services: services.map((s) => ({ id: s.id, label: s.name })),
    qualifications,
    bdes,
    campaigns: campaigns.map((r) => r.campaign).filter((v): v is string => !!v),
    countries: countries.map((r) => r.country).filter((v): v is string => !!v),
    destinations: destinations.map((r) => r.studyDestination).filter((v): v is string => !!v),
    qualityReasons,
  });
});
