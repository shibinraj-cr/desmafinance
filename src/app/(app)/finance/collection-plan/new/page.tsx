import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getTransactionFormMasters } from "@/lib/master-data";
import { TopBar } from "@/components/TopBar";
import { NewPlanForm } from "./client";

export const dynamic = "force-dynamic";

export default async function NewCollectionPlanPage({
  searchParams,
}: {
  searchParams: { partyId?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");

  const masters = await getTransactionFormMasters();

  // Include any party (Candidate or Vendor) that accepts Revenue tx —
  // the dropdown label is "Candidate/Vendors" so both groups belong.
  const candidates = masters.parties.filter(
    (p) => p.txTypes === "Revenue" || p.txTypes === "Both",
  );

  return (
    <>
      <TopBar title="New Collection Plan" subtitle="Stage expected installments for a candidate" />
      <div className="p-margin max-w-4xl">
        <NewPlanForm
          parties={candidates}
          initialPartyId={searchParams.partyId ?? null}
        />
      </div>
    </>
  );
}
