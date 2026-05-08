import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import {
  CategoriesEditor,
  NewCategoryButton,
  ExpenseMasterMigrationButton,
  PartiesSchemaSyncButton,
} from "./client";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!canManageUsers(perms)) {
    return (
      <>
        <TopBar title="Categories" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              You need admin access to manage master data.
            </div>
          </Section>
        </div>
      </>
    );
  }

  const [categories, services] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      include: {
        subItems: {
          orderBy: { name: "asc" },
          include: { service: { select: { id: true, name: true } } },
        },
        _count: { select: { subItems: true } },
      },
    }),
    prisma.service.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // For each category, compute how many transactions reference it (read-only, used to gate delete in UI).
  const txCounts = await prisma.transaction.groupBy({
    by: ["category"],
    where: { deletedAt: null },
    _count: true,
  });
  const txByCategory = new Map<string, number>();
  for (const r of txCounts) txByCategory.set(r.category, r._count);

  return (
    <>
      <TopBar
        title="Categories"
        subtitle={`${categories.length} categor${categories.length === 1 ? "y" : "ies"}`}
        action={<NewCategoryButton />}
      />
      <div className="p-margin space-y-lg">
        <PartiesSchemaSyncButton />
        <ExpenseMasterMigrationButton />
        <CategoriesEditor
          categories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type as "Revenue" | "Expense" | "Both",
            isActive: c.isActive,
            isSystem: c.isSystem,
            subItems: c.subItems.map((s) => ({
              id: s.id,
              name: s.name,
              isActive: s.isActive,
              isSystem: s.isSystem,
              serviceId: s.serviceId,
              serviceName: s.service?.name ?? null,
            })),
            txCount: txByCategory.get(c.name) ?? 0,
          }))}
          services={services}
        />
      </div>
    </>
  );
}
