import { redirect } from "next/navigation";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { loadPartiesPayload } from "@/lib/party-data";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { PartiesEditor, NewPartyButton, CandidateImportButton } from "./client";

export const dynamic = "force-dynamic";

export default async function PartiesPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!canManageUsers(perms)) {
    return (
      <>
        <TopBar title="Parties" />
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

  const [parties, services, sources] = await loadPartiesPayload();

  return (
    <>
      <TopBar
        title="Parties"
        subtitle={`${parties.length} part${parties.length === 1 ? "y" : "ies"}`}
        action={<NewPartyButton services={services} sources={sources} />}
      />
      <div className="p-margin space-y-lg">
        <CandidateImportButton />
        <PartiesEditor
          services={services}
          sources={sources}
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
