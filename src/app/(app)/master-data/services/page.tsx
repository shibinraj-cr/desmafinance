import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { ServicesEditor, NewServiceButton } from "./client";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!canManageUsers(perms)) {
    return (
      <>
        <TopBar title="Services" />
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

  const services = await prisma.service.findMany({
    orderBy: [{ name: "asc" }],
    include: {
      subItems: {
        select: {
          id: true,
          name: true,
          category: { select: { id: true, name: true } },
        },
        orderBy: { name: "asc" },
      },
    },
  });

  // Tx counts per service: count transactions whose subItem name + category match
  // any sub-item linked to the service. Easier: count by joining sub-items.
  const txByService = new Map<string, number>();
  for (const s of services) {
    if (!s.subItems.length) {
      txByService.set(s.id, 0);
      continue;
    }
    const count = await prisma.transaction.count({
      where: {
        deletedAt: null,
        OR: s.subItems.map((sub) => ({
          subItem: sub.name,
          category: sub.category.name,
        })),
      },
    });
    txByService.set(s.id, count);
  }

  return (
    <>
      <TopBar
        title="Services"
        subtitle={`${services.length} service${services.length === 1 ? "" : "s"}`}
        action={<NewServiceButton />}
      />
      <div className="p-margin space-y-lg">
        <ServicesEditor
          services={services.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            isActive: s.isActive,
            subItems: s.subItems.map((sub) => ({
              id: sub.id,
              name: sub.name,
              categoryName: sub.category.name,
            })),
            txCount: txByService.get(s.id) ?? 0,
          }))}
        />
      </div>
    </>
  );
}
