import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { AGREEMENTS_PAGE } from "@/lib/esign/requests";
import { getOtpWhatsAppTemplate, isSendingEnabled } from "@/lib/esign/settings";
import { fieldFromRow } from "@/lib/esign/store";
import { readPageGeometry } from "@/lib/esign/templates";
import { NewAgreementWizard, type DraftInfo, type LeadInfo, type StaffOption, type TemplateOption } from "./client";

export const dynamic = "force-dynamic";

const leadSelect = {
  id: true,
  candidateName: true,
  email: true,
  phone: true,
  dob: true,
  expectedValue: true,
  service: { select: { name: true } },
} as const;

function toLeadInfo(l: {
  id: string;
  candidateName: string;
  email: string | null;
  phone: string | null;
  dob: Date | null;
  expectedValue: unknown;
  service: { name: string } | null;
}): LeadInfo {
  return {
    id: l.id,
    name: l.candidateName,
    email: l.email,
    phone: l.phone,
    dob: l.dob ? l.dob.toISOString().slice(0, 10) : null,
    expectedValue: l.expectedValue != null ? Number(l.expectedValue) : null,
    serviceName: l.service?.name ?? null,
  };
}

const personName = (u: { username: string; employeeProfile: { name: string } | null; leadPulseRole: { displayName: string } | null }) =>
  u.employeeProfile?.name ?? u.leadPulseRole?.displayName ?? u.username;

export default async function NewAgreementPage({ searchParams }: { searchParams: { leadId?: string; draft?: string } }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  if (!canSeePage(perms, AGREEMENTS_PAGE)) redirect(AGREEMENTS_PAGE);

  const draftRow = searchParams.draft
    ? await prisma.esignRequest.findUnique({
        where: { id: searchParams.draft },
        include: { signers: { orderBy: { signOrder: "asc" } }, templateVersion: { select: { templateId: true } } },
      })
    : null;
  if (searchParams.draft && (!draftRow || draftRow.status !== "draft")) redirect(`/operations/agreements/${searchParams.draft}`);

  const leadId = draftRow?.leadId ?? searchParams.leadId ?? null;
  const userSelect = { id: true, username: true, email: true, employeeProfile: { select: { name: true } }, leadPulseRole: { select: { displayName: true } } } as const;
  const [templates, lead, me, staffUsers, sendingEnabled, otpTemplate] = await Promise.all([
    prisma.esignTemplate.findMany({
      where: { active: true, currentVersionId: { not: null } },
      orderBy: { name: "asc" },
      include: { currentVersion: { include: { fields: { orderBy: { sortOrder: "asc" } } } } },
    }),
    leadId ? prisma.lead.findUnique({ where: { id: leadId }, select: leadSelect }) : null,
    prisma.user.findUnique({ where: { id: userId }, select: userSelect }),
    prisma.user.findMany({ where: { isActive: true, email: { not: null } }, orderBy: { username: "asc" }, select: userSelect }),
    isSendingEnabled(),
    getOtpWhatsAppTemplate(),
  ]);

  const templateOptions: TemplateOption[] = templates.map((t) => {
    const v = t.currentVersion!;
    return {
      id: t.id,
      name: t.name,
      category: t.category,
      versionId: v.id,
      version: v.version,
      numPages: v.numPages,
      fileSize: v.fileSize,
      pages: readPageGeometry(v.pages, v.numPages),
      fields: v.fields.map(fieldFromRow),
      defaultExpiryDays: t.defaultExpiryDays,
      defaultReminderDays: t.defaultReminderDays,
      hasEmailText: !!(t.emailSubject || t.emailBody),
      whatsappTemplateName: t.whatsappTemplateName,
    };
  });

  const draft: DraftInfo | null = draftRow
    ? {
        id: draftRow.id,
        templateId: draftRow.templateVersion?.templateId ?? null,
        mergeData: (draftRow.mergeData ?? {}) as Record<string, string>,
        signers: draftRow.signers.map((s) => ({
          role: s.role as "Client" | "DESMA",
          userId: s.userId,
          name: s.name,
          email: s.email,
          phone: s.phone,
          signOrder: s.signOrder,
        })),
        cc: (Array.isArray(draftRow.cc) ? draftRow.cc : []) as Array<{ name: string; email: string }>,
        reminderDays: draftRow.reminderDays ?? 3,
        message: draftRow.message,
      }
    : null;

  const staff: StaffOption[] = staffUsers.map((u) => ({ id: u.id, name: personName(u), email: u.email! }));

  return (
    <>
      <TopBar title={draft ? "Continue agreement" : "New agreement"} subtitle={lead ? lead.candidateName : "Send for e-signature"} />
      <NewAgreementWizard
        templates={templateOptions}
        lead={lead ? toLeadInfo(lead) : null}
        draft={draft}
        staff={staff}
        staffName={me ? personName(me) : ""}
        sendingEnabled={sendingEnabled}
        otpByWhatsApp={!!otpTemplate}
        nowIso={new Date().toISOString()}
      />
    </>
  );
}
