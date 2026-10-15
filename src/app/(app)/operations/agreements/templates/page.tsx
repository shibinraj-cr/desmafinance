import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { isBlobConfigured } from "@/lib/finance-docs-store";
import { AGREEMENT_TEMPLATES_PAGE } from "@/lib/esign/templates";
import { TemplatesClient, type TemplateRow } from "./client";

export const dynamic = "force-dynamic";

export default async function AgreementTemplatesPage() {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, AGREEMENT_TEMPLATES_PAGE)) {
    return (
      <>
        <TopBar title="Agreement Templates" />
        <div className="p-margin text-body-md text-on-surface-variant">
          Agreement templates are managed by admins and roles granted this page in Roles.
        </div>
      </>
    );
  }

  const templates = await prisma.esignTemplate.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      category: true,
      description: true,
      active: true,
      updatedAt: true,
      currentVersion: { select: { version: true, numPages: true, _count: { select: { fields: true } } } },
      versions: { select: { _count: { select: { requests: true } } } },
    },
  });

  const rows: TemplateRow[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
    active: t.active,
    updatedAt: t.updatedAt.toISOString(),
    version: t.currentVersion?.version ?? null,
    numPages: t.currentVersion?.numPages ?? null,
    fieldCount: t.currentVersion?._count.fields ?? 0,
    sentCount: t.versions.reduce((n, v) => n + v._count.requests, 0),
  }));

  return (
    <>
      <TopBar title="Agreement Templates" subtitle="Master agreements, filled from the CRM and sent for e-signature" />
      <div className="p-margin">
        <TemplatesClient templates={rows} blobReady={isBlobConfigured()} />
      </div>
    </>
  );
}
