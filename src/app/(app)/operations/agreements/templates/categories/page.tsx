import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { AGREEMENT_TEMPLATES_PAGE } from "@/lib/esign/templates";
import { canManageAgreementCategories } from "@/lib/esign/categories";
import { listTemplateCategories } from "@/lib/esign/categories-store";
import { CategoriesClient, type CategoryRow } from "./client";

export const dynamic = "force-dynamic";

export default async function AgreementCategoriesPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  if (!canManageAgreementCategories(userId, perms)) {
    return (
      <>
        <TopBar title="Agreement Categories" />
        <div className="p-margin text-body-md text-on-surface-variant">
          Agreement categories are managed by admins, Operations managers and roles granted Agreement Templates in Roles.
        </div>
      </>
    );
  }

  const [categories, counts] = await Promise.all([
    listTemplateCategories(),
    prisma.esignTemplate.groupBy({ by: ["category", "active"], _count: { _all: true } }),
  ]);
  const count = (name: string, active: boolean) =>
    counts.find((c) => c.category === name && c.active === active)?._count._all ?? 0;
  const rows: CategoryRow[] = categories.map((c) => ({
    ...c,
    templates: count(c.name, true),
    archivedTemplates: count(c.name, false),
  }));

  // Operations managers without the templates grant come here from Operations Settings.
  const back = canSeePage(perms, AGREEMENT_TEMPLATES_PAGE)
    ? { href: AGREEMENT_TEMPLATES_PAGE, label: "All templates" }
    : { href: "/operations/settings", label: "Operations Settings" };

  return (
    <>
      <TopBar
        title="Agreement Categories"
        subtitle="Group agreement templates for filtering and sending"
        action={
          <Link href={back.href} className="text-body-md text-on-surface-variant hover:underline">
            {back.label}
          </Link>
        }
      />
      <div className="p-margin">
        <CategoriesClient categories={rows} />
      </div>
    </>
  );
}
