import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { FieldBuilder } from "@/components/esign/FieldBuilder";
import { fieldFromRow } from "@/lib/esign/store";
import { AGREEMENT_TEMPLATES_PAGE, readPageGeometry } from "@/lib/esign/templates";

export const dynamic = "force-dynamic";

export default async function AgreementTemplateBuilderPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { version?: string; forked?: string };
}) {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, AGREEMENT_TEMPLATES_PAGE)) redirect(AGREEMENT_TEMPLATES_PAGE);

  const template = await prisma.esignTemplate.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, active: true, currentVersionId: true, updatedAt: true },
  });
  if (!template) notFound();

  const versionId = searchParams.version ?? template.currentVersionId;
  if (!versionId) redirect(`/operations/agreements/templates/${template.id}`);
  const version = await prisma.esignTemplateVersion.findFirst({
    where: { id: versionId, templateId: template.id },
    include: {
      fields: { orderBy: { sortOrder: "asc" } },
      _count: { select: { requests: true } },
    },
  });
  if (!version) notFound();

  const isCurrent = version.id === template.currentVersionId;
  const readOnlyReason = !template.active
    ? "This template is archived, so its fields are read only. Restore it to edit."
    : !isCurrent
      ? `You are viewing v${version.version}, an older version. Only the current version can be edited.`
      : null;
  const forked = Number(searchParams.forked);

  return (
    <>
      <TopBar title="Agreement fields" subtitle={template.name} />
      <FieldBuilder
        key={version.id}
        templateId={template.id}
        templateName={template.name}
        version={{
          id: version.id,
          version: version.version,
          numPages: version.numPages,
          fileSize: version.fileSize,
          pages: readPageGeometry(version.pages, version.numPages),
        }}
        initialFields={version.fields.map(fieldFromRow)}
        updatedAt={template.updatedAt.toISOString()}
        sentCount={version._count.requests}
        readOnly={readOnlyReason !== null}
        readOnlyReason={readOnlyReason}
        forkedFrom={isCurrent && Number.isInteger(forked) && forked > 0 ? forked : null}
      />
    </>
  );
}
