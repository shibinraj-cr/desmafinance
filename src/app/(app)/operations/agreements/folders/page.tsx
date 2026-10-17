import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { AGREEMENTS_PAGE } from "@/lib/esign/requests";
import { FoldersList, type FolderRow } from "./client";
import { NoAccess } from "./_no-access";

export const dynamic = "force-dynamic";

export default async function AgreementFoldersPage() {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, AGREEMENTS_PAGE)) return <NoAccess />;

  const folders = await prisma.agreementFolder.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, updatedAt: true, _count: { select: { documents: true } } },
  });

  const rows: FolderRow[] = folders.map((f) => ({
    id: f.id,
    name: f.name,
    updatedAt: f.updatedAt.toISOString(),
    documents: f._count.documents,
  }));

  return (
    <>
      <TopBar title="Agreement Folders" subtitle="Signed agreements kept as files, such as the Odoo Sign archive" />
      <div className="p-margin">
        <FoldersList rows={rows} isAdmin={perms.isAdmin} />
      </div>
    </>
  );
}
