import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { loadPartiesPayload } from "@/lib/party-data";
import { loadEmployeeDirectory } from "@/lib/hr-data";
import { TopBar } from "@/components/TopBar";
import { FinancePartiesView } from "./FinancePartiesView";

export const dynamic = "force-dynamic";

/**
 * Finance "Parties" page. Combines the Candidates & Vendors editor (a mirror of
 * /master-data/parties, accessible to any authenticated user) with a read-only
 * Employees directory (name / designation / department only) so salary and
 * incentive outflows can be attributed to people. Employee records themselves
 * are created and managed exclusively in the HR module.
 */
export default async function FinancePartiesPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");

  const [[parties, services, sources], employees] = await Promise.all([
    loadPartiesPayload(),
    loadEmployeeDirectory(),
  ]);

  return (
    <>
      <TopBar
        title="Parties"
        subtitle={`${parties.length} part${parties.length === 1 ? "y" : "ies"} · ${employees.length} employees`}
      />
      <div className="p-margin space-y-lg">
        <FinancePartiesView
          services={services}
          sources={sources}
          employees={employees}
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
