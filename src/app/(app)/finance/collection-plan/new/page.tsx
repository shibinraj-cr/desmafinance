import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getTransactionFormMasters } from "@/lib/master-data";
import { TopBar } from "@/components/TopBar";
import { NewPlanForm } from "./client";
import { PAYMENT_MODES } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function NewCollectionPlanPage({
  searchParams,
}: {
  searchParams: { partyId?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");

  const [masters, services] = await Promise.all([
    getTransactionFormMasters(),
    prisma.service.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // Restrict the party dropdown to Candidates that accept Revenue tx.
  const candidates = masters.parties.filter(
    (p) => p.group === "Candidate" && (p.txTypes === "Revenue" || p.txTypes === "Both"),
  );
  const revenueCategories = masters.categories.filter(
    (c) => c.isActive && (c.type === "Revenue" || c.type === "Both"),
  );

  return (
    <>
      <TopBar title="New Collection Plan" subtitle="Stage expected installments for a candidate" />
      <div className="p-margin max-w-4xl">
        <NewPlanForm
          parties={candidates}
          services={services}
          categories={revenueCategories}
          paymentModes={[...PAYMENT_MODES]}
          initialPartyId={searchParams.partyId ?? null}
        />
      </div>
    </>
  );
}
