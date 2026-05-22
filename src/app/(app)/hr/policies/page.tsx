import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { PoliciesClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HrPoliciesPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Policies & Manuals" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }
  const policies = await prisma.hrPolicy.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { acks: true } } },
  });
  const totalEmployees = await prisma.employee.count({ where: { active: true, userId: { not: null } } });
  return (
    <>
      <TopBar title="Policies & Manuals" subtitle={`${policies.length} policies`} />
      <div className="p-margin">
        <PoliciesClient
          policies={policies.map((p) => ({
            id: p.id,
            title: p.title,
            version: p.version,
            body: p.body,
            externalUrl: p.externalUrl,
            category: p.category,
            requiresAck: p.requiresAck,
            status: p.status,
            publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
            ackCount: p._count.acks,
            totalEligible: totalEmployees,
          }))}
          canEdit={canApproveHr(perms)}
        />
      </div>
    </>
  );
}
