import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { isBlobConfigured } from "@/lib/finance-docs-store";
import { AGREEMENTS_PAGE } from "@/lib/esign/requests";
import { NoAccess } from "../_no-access";
import { FolderBrowser, type DocRow } from "./client";

export const dynamic = "force-dynamic";

export default async function AgreementFolderPage({ params }: { params: { id: string } }) {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, AGREEMENTS_PAGE)) return <NoAccess />;

  const folder = await prisma.agreementFolder.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      documents: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          size: true,
          contentType: true,
          createdAt: true,
          uploadedBy: { select: { username: true } },
        },
      },
    },
  });
  if (!folder) notFound();

  const documents: DocRow[] = folder.documents.map((d) => ({
    id: d.id,
    name: d.name,
    size: d.size,
    contentType: d.contentType,
    createdAt: d.createdAt.toISOString(),
    uploadedBy: d.uploadedBy?.username ?? null,
  }));

  return (
    <>
      <TopBar
        title={folder.name}
        subtitle={`${documents.length} ${documents.length === 1 ? "document" : "documents"} · Agreement folder`}
      />
      <div className="p-margin space-y-md">
        <FolderBrowser
          folder={{ id: folder.id, name: folder.name }}
          documents={documents}
          isAdmin={perms.isAdmin}
          storageReady={isBlobConfigured()}
        />
      </div>
    </>
  );
}
