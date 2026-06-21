import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { recordLeadOpenedOncePerDay } from "@/lib/crm-activity";
import {
  leadRowInclude,
  serializeLead,
  noteInclude,
  serializeNote,
  activityInclude,
  serializeActivity,
  getAssignableBdes,
  taskInclude,
  serializeTask,
  taskOrderBy,
} from "@/lib/crm-leads";
import { LeadDetail } from "./client";

export const dynamic = "force-dynamic";

// Activities shown directly as note cards (NOTE_*) or that are passive
// (LEAD_OPENED) are excluded from the center Timeline; the full set lives in
// the admin History tab.
const TIMELINE_EXCLUDE = ["LEAD_OPENED", "NOTE_ADDED", "NOTE_EDITED", "NOTE_DELETED"];

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) {
    return (
      <>
        <TopBar title="Lead" subtitle="CRM" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            You don&apos;t have access to the CRM.
          </div>
        </div>
      </>
    );
  }

  const lead = await prisma.lead.findUnique({ where: { id: params.id }, include: leadRowInclude });
  if (!lead) notFound();

  const [notes, activities, tasks, statuses, sources, services, qualifications, bdes, parties] = await Promise.all([
    prisma.leadNote.findMany({ where: { leadId: params.id }, orderBy: { createdAt: "desc" }, include: noteInclude }),
    prisma.leadActivity.findMany({
      where: { leadId: params.id, type: { notIn: TIMELINE_EXCLUDE } },
      orderBy: { occurredAt: "desc" },
      take: 200,
      include: activityInclude,
    }),
    prisma.crmTask.findMany({ where: { leadId: params.id }, orderBy: taskOrderBy, include: taskInclude }),
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
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.crmQualification.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true },
    }),
    getAssignableBdes(),
    prisma.party.findMany({
      where: { group: "Candidate", isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // Best-effort: record that this user opened the lead (once per day).
  await recordLeadOpenedOncePerDay(params.id, userId);

  // Other leads sharing this lead's email or phone — so a flagged duplicate
  // shows exactly which record(s) it matches (and any lead shows its twins).
  const dupOr: Array<{ emailKey: string } | { phoneE164: string }> = [];
  if (lead.emailKey) dupOr.push({ emailKey: lead.emailKey });
  if (lead.phoneE164) dupOr.push({ phoneE164: lead.phoneE164 });
  const dupRows = dupOr.length
    ? await prisma.lead.findMany({
        where: { id: { not: lead.id }, OR: dupOr },
        orderBy: { createdAt: "asc" },
        take: 25,
        select: {
          id: true,
          candidateName: true,
          email: true,
          phone: true,
          emailKey: true,
          phoneE164: true,
          createdAt: true,
          source: { select: { label: true } },
          status: { select: { label: true, color: true } },
        },
      })
    : [];
  const duplicates = dupRows.map((d) => {
    const on: string[] = [];
    if (lead.emailKey && d.emailKey === lead.emailKey) on.push("email");
    if (lead.phoneE164 && d.phoneE164 === lead.phoneE164) on.push("phone");
    return {
      id: d.id,
      candidateName: d.candidateName,
      email: d.email,
      phone: d.phone,
      createdAt: d.createdAt.toISOString(),
      source: d.source?.label ?? null,
      status: { label: d.status.label, color: d.status.color },
      matchedOn: on.join(" + "),
    };
  });

  const masters = {
    statuses,
    sources,
    services: services.map((s) => ({ id: s.id, label: s.name })),
    qualifications,
    bdes,
    parties: parties.map((p) => ({ id: p.id, label: p.name })),
  };

  return (
    <>
      <TopBar
        title={lead.candidateName}
        subtitle="Lead"
        action={
          <Link
            href="/crm/leads"
            className="inline-flex items-center gap-xs h-9 px-md rounded-lg border border-outline-variant text-on-surface-variant text-label-sm font-semibold hover:bg-surface-container-low transition"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              arrow_back
            </span>
            All leads
          </Link>
        }
      />
      <div className="p-margin">
        <LeadDetail
          lead={serializeLead(lead)}
          notes={notes.map(serializeNote)}
          timeline={activities.map((a) => serializeActivity(a, { includeMetadata: false }))}
          tasks={tasks.map(serializeTask)}
          duplicates={duplicates}
          masters={masters}
          canEdit={canEditLead(access, lead, userId)}
          access={{
            isAdmin: access.isAdmin,
            canAssign: access.canAssign,
            canViewHistory: access.canViewHistory,
            userId,
          }}
        />
      </div>
    </>
  );
}
