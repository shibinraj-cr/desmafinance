import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { loadPartiesPayload } from "@/lib/party-data";
import { TopBar } from "@/components/TopBar";
import {
  PartiesEditor,
  NewPartyButton,
} from "@/app/(app)/master-data/parties/client";

export const dynamic = "force-dynamic";

/**
 * Marketing-module mirror of /master-data/parties. Same UI, same APIs
 * — accessible to any authenticated user, so the marketing team can
 * manage candidates without needing master-data admin rights.
 */
export default async function MarketingPartiesPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");

  const [parties, services, sources] = await loadPartiesPayload();

  return (
    <>
      <TopBar
        title="Candidates & Vendors"
        subtitle={`${parties.length} part${parties.length === 1 ? "y" : "ies"}`}
        action={<NewPartyButton services={services} sources={sources} />}
      />
      <div className="p-margin space-y-lg">
        <PartiesEditor
          services={services}
          sources={sources}
          basePath="/marketing/parties"
          parties={parties.map((p) => ({
            id: p.id,
            name: p.name,
            group: p.group as "Candidate" | "Vendor",
            txTypes: p.txTypes as "Revenue" | "Expense" | "Both",
            email: p.email,
            phone: p.phone,
            notes: p.notes,
            isActive: p.isActive,
            txCount: p._count.transactions,
            services: p.services,
            sourceId: p.sourceId,
            sourceLabel: p.source?.label ?? null,
          }))}
        />
      </div>
    </>
  );
}
