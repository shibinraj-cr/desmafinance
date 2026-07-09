import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { DateFilter } from "@/components/DateFilter";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { parsePeriod, rangeFor } from "@/lib/period";
import {
  buildLeadWhere,
  leadOrderBy,
  leadRowInclude,
  serializeLead,
  getAssignableBdes,
  countNewLeadsAssignedTo,
  assignedDayRange,
  resolveAssigneeFilter,
} from "@/lib/crm-leads";
import { parseAgeParam } from "@/lib/age";
import { isEmailConfigured } from "@/lib/mailer";
import { listMessageTemplates } from "@/lib/crm-message-templates";
import { LeadsToolbar, LeadsTable } from "./client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SP = { [k: string]: string | string[] | undefined };

function str(sp: SP, k: string): string | undefined {
  const v = sp[k];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function LeadsPage({ searchParams }: { searchParams: SP }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) {
    return (
      <>
        <TopBar title="Leads" subtitle="CRM" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            You don&apos;t have access to the CRM. Ask an administrator to grant you the Leads page.
          </div>
        </div>
      </>
    );
  }

  const requestedPage = Math.max(1, parseInt(str(searchParams, "page") || "1", 10) || 1);
  const sort = str(searchParams, "sort");
  const range = rangeFor(
    parsePeriod({
      period: str(searchParams, "period"),
      from: str(searchParams, "from"),
      to: str(searchParams, "to"),
    }),
  );
  const assignedOn = str(searchParams, "assignedOn");
  const assigned = assignedDayRange(assignedOn);
  const where = buildLeadWhere({
    status: str(searchParams, "status"),
    source: str(searchParams, "source"),
    service: str(searchParams, "service"),
    // BDEs default to their own queue ("my leads") until they pick a consultant
    // or explicitly choose "All leads"; everyone else sees all leads.
    assignee: resolveAssigneeFilter(str(searchParams, "assignee"), { isBde: access.isBde, userId }),
    campaign: str(searchParams, "campaign"),
    country: str(searchParams, "country"),
    studyDestination: str(searchParams, "studyDestination"),
    ageMin: parseAgeParam(str(searchParams, "ageMin")),
    ageMax: parseAgeParam(str(searchParams, "ageMax")),
    q: str(searchParams, "q"),
    from: range.from,
    to: range.to,
    assignedFrom: assigned?.from,
    assignedTo: assigned?.to,
  });

  // Clamp the page against the result size so a stale `page` (e.g. left over
  // after narrowing the date range) never renders an empty out-of-range page.
  const total = await prisma.lead.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const [rows, statuses, sources, services, qualifications, bdes, campaignGroups, countryGroups, destinationGroups, emailConfigured, emailTemplates] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: leadOrderBy(sort),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: leadRowInclude,
    }),
    prisma.crmLeadStatus.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
      select: { id: true, code: true, label: true, kind: true, color: true },
    }),
    prisma.leadPulseSource.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true },
    }),
    prisma.service.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.crmQualification.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true },
    }),
    getAssignableBdes(),
    prisma.lead.groupBy({
      by: ["campaign"],
      where: { campaign: { not: null } },
      orderBy: { campaign: "asc" },
    }),
    prisma.lead.groupBy({
      by: ["country"],
      where: { country: { not: null } },
      orderBy: { country: "asc" },
    }),
    prisma.lead.groupBy({
      by: ["studyDestination"],
      where: { studyDestination: { not: null } },
      orderBy: { studyDestination: "asc" },
    }),
    isEmailConfigured(),
    listMessageTemplates({ channel: "email", activeOnly: true }),
  ]);

  // Fresh leads assigned to the signed-in BDE — drives the "My new leads" chip
  // count (only the BDE's own queue matters; 0 for non-assignees).
  const newLeadsCount = access.isBde ? await countNewLeadsAssignedTo(userId) : 0;

  const masters = {
    statuses,
    sources,
    services: services.map((s) => ({ id: s.id, label: s.name })),
    qualifications,
    bdes,
    campaigns: campaignGroups.map((g) => g.campaign).filter((c): c is string => !!c),
    countries: countryGroups.map((g) => g.country).filter((c): c is string => !!c),
    studyDestinations: destinationGroups.map((g) => g.studyDestination).filter((c): c is string => !!c),
  };
  const accessProps = {
    canCreate: access.canCreateLeads,
    canAssign: access.canAssign,
    canBulkImport: access.canBulkImport,
    canBulkEmail: access.canBulkEmail,
    emailConfigured,
    isAdmin: access.isAdmin,
    isBde: access.isBde,
    userId,
    newLeadsCount,
  };

  return (
    <>
      <TopBar
        title="Leads"
        subtitle={
          assigned
            ? `${total} lead${total === 1 ? "" : "s"} assigned on ${assigned.from.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
            : `${total} lead${total === 1 ? "" : "s"}`
        }
        action={
          <div className="flex items-center gap-base">
            <DateFilter />
            <LeadsToolbar masters={masters} access={accessProps} />
          </div>
        }
      />
      <div className="p-margin space-y-lg">
        <LeadsTable
          leads={rows.map(serializeLead)}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          masters={masters}
          access={accessProps}
          templates={emailTemplates}
        />
      </div>
    </>
  );
}
