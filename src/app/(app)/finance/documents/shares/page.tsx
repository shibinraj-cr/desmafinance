import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { FINANCE_DOCS_PAGE, formatIstDate, sharePath, shareState } from "@/lib/finance-docs";
import { SharesTable } from "./client";

export const dynamic = "force-dynamic";

/**
 * Every share link ever made, newest first. A child of /finance/documents so
 * the same page grant reaches it.
 */
export default async function FinanceDocSharesPage() {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, `${FINANCE_DOCS_PAGE}/shares`)) redirect("/finance/overview");

  const now = new Date();
  const shares = await prisma.financeDocShare.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      document: { select: { id: true, name: true, folderId: true } },
      folder: { select: { id: true, name: true } },
      createdBy: { select: { username: true } },
    },
  });

  const rows = shares.map((s) => ({
    id: s.id,
    path: sharePath(s.token),
    label: s.label,
    kind: s.folder ? ("folder" as const) : ("document" as const),
    targetName: s.folder?.name ?? s.document?.name ?? "—",
    targetHref: s.folder
      ? `${FINANCE_DOCS_PAGE}?folder=${s.folder.id}`
      : s.document?.folderId
        ? `${FINANCE_DOCS_PAGE}?folder=${s.document.folderId}`
        : FINANCE_DOCS_PAGE,
    period: `${formatIstDate(s.validFrom)} – ${formatIstDate(s.expiresAt)}`,
    state: shareState(s, now),
    downloads: s.downloadCount,
    lastAccessed: s.lastAccessedAt ? formatIstDate(s.lastAccessedAt) : null,
    createdBy: s.createdBy?.username ?? null,
    createdAt: formatIstDate(s.createdAt),
  }));

  return (
    <>
      <TopBar
        title="Shared links"
        subtitle="Public, download-only links to finance documents"
        action={
          <Link
            href={FINANCE_DOCS_PAGE}
            className="inline-flex items-center gap-xs px-md py-sm rounded-md border border-outline-variant text-body-md font-semibold hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Documents
          </Link>
        }
      />
      <div className="p-margin">
        <SharesTable rows={rows} />
      </div>
    </>
  );
}
