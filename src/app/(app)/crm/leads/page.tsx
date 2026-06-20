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
} from "@/lib/crm-leads";
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
  const where = buildLeadWhere({
    status: str(searchParams, "status"),
    source: str(searchParams, "source"),
    service: str(searchParams, "service"),
    assignee: str(searchParams, "assignee"),
    campaign: str(searchParams, "campaign"),
    q: str(searchParams, "q"),
    from: range.from,
    to: range.to,
  });

  // Clamp the page against the result size so a stale `page` (e.g. left over
  // after narrowing the date range) never renders an empty out-of-range page.
  const total = await prisma.lead.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const [rows, statuses, sources, services, qualifications, bdes, campaignGroups] = await Promise.all([
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
  ]);

  const masters = {
    statuses,
    sources,
    services: services.map((s) => ({ id: s.id, label: s.name })),
    qualifications,
    bdes,
    campaigns: campaignGroups.map((g) => g.campaign).filter((c): c is string => !!c),
  };
  const accessProps = {
    canCreate: access.canCreateLeads,
    canAssign: access.canAssign,
    canBulkImport: access.canBulkImport,
    isAdmin: access.isAdmin,
    isBde: access.isBde,
    userId,
  };

  return (
    <>
      <TopBar
        title="Leads"
        subtitle={`${total} lead${total === 1 ? "" : "s"}`}
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
        />
      </div>
    </>
  );
}
