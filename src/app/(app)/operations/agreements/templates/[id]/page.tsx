import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { isBlobConfigured } from "@/lib/finance-docs-store";
import { AGREEMENT_TEMPLATES_PAGE } from "@/lib/esign/templates";
import { TemplateDetailClient, type TemplateDetail } from "./client";

export const dynamic = "force-dynamic";

export default async function AgreementTemplatePage({ params }: { params: { id: string } }) {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, AGREEMENT_TEMPLATES_PAGE)) redirect(AGREEMENT_TEMPLATES_PAGE);

  const t = await prisma.esignTemplate.findUnique({
    where: { id: params.id },
    include: {
      createdBy: { select: { username: true } },
      versions: {
        orderBy: { version: "desc" },
        include: {
          createdBy: { select: { username: true } },
          _count: { select: { fields: true, requests: true } },
        },
      },
    },
  });
  if (!t) notFound();

  const detail: TemplateDetail = {
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
    defaultExpiryDays: t.defaultExpiryDays,
    defaultReminderDays: t.defaultReminderDays,
    emailSubject: t.emailSubject,
    emailBody: t.emailBody,
    whatsappTemplateName: t.whatsappTemplateName,
    active: t.active,
    currentVersionId: t.currentVersionId,
    createdBy: t.createdBy?.username ?? null,
    createdAt: t.createdAt.toISOString(),
    versions: t.versions.map((v) => ({
      id: v.id,
      version: v.version,
      fileName: v.fileName,
      fileSize: v.fileSize,
      fileSha256: v.fileSha256,
      numPages: v.numPages,
      notes: v.notes,
      fieldCount: v._count.fields,
      sentCount: v._count.requests,
      createdBy: v.createdBy?.username ?? null,
      createdAt: v.createdAt.toISOString(),
    })),
  };

  return (
    <>
      <TopBar
        title={t.name}
        subtitle={t.category}
        action={
          <Link href={AGREEMENT_TEMPLATES_PAGE} className="text-body-md text-on-surface-variant hover:underline">
            All templates
          </Link>
        }
      />
      <div className="p-margin">
        <TemplateDetailClient template={detail} blobReady={isBlobConfigured()} />
      </div>
    </>
  );
}
