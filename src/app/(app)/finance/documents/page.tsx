import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { FINANCE_DOCS_PAGE, folderChain } from "@/lib/finance-docs";
import { isBlobConfigured } from "@/lib/finance-docs-store";
import { DocumentsBrowser } from "./client";

export const dynamic = "force-dynamic";

export default async function FinanceDocumentsPage({
  searchParams,
}: {
  searchParams: { folder?: string };
}) {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, FINANCE_DOCS_PAGE)) redirect("/finance/overview");

  const allFolders = await prisma.financeDocFolder.findMany({
    select: { id: true, name: true, parentId: true },
  });
  const folderId = searchParams.folder && allFolders.some((f) => f.id === searchParams.folder)
    ? searchParams.folder
    : null;
  if (searchParams.folder && !folderId) redirect(FINANCE_DOCS_PAGE);

  const [folders, documents, activeLinks] = await Promise.all([
    prisma.financeDocFolder.findMany({
      where: { parentId: folderId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        _count: { select: { children: true, documents: true } },
      },
    }),
    prisma.financeDocument.findMany({
      where: { folderId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        size: true,
        contentType: true,
        createdAt: true,
        uploadedBy: { select: { username: true } },
      },
    }),
    prisma.financeDocShare.count({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
    }),
  ]);

  const chain = folderChain(allFolders, folderId);

  return (
    <>
      <TopBar
        title="Documents"
        subtitle={chain.length ? chain.map((f) => f.name).join(" / ") : "All financial documents"}
        action={
          <Link
            href={`${FINANCE_DOCS_PAGE}/shares`}
            className="inline-flex items-center gap-xs px-md py-sm rounded-md border border-outline-variant text-body-md font-semibold hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[18px]">link</span>
            Shared links{activeLinks ? ` (${activeLinks})` : ""}
          </Link>
        }
      />
      <div className="p-margin space-y-md">
        <DocumentsBrowser
          key={folderId ?? "root"}
          folderId={folderId}
          chain={chain.map((f) => ({ id: f.id, name: f.name }))}
          folders={folders.map((f) => ({
            id: f.id,
            name: f.name,
            updatedAt: f.updatedAt.toISOString(),
            items: f._count.children + f._count.documents,
          }))}
          documents={documents.map((d) => ({
            id: d.id,
            name: d.name,
            size: d.size,
            contentType: d.contentType,
            createdAt: d.createdAt.toISOString(),
            uploadedBy: d.uploadedBy?.username ?? null,
          }))}
          storageReady={isBlobConfigured()}
        />
      </div>
    </>
  );
}
