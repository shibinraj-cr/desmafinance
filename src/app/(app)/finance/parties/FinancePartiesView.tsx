"use client";

import { useState } from "react";
import {
  PartiesEditor,
  NewPartyButton,
  type SourceOption,
} from "@/app/(app)/master-data/parties/client";
import type { EmployeeDirectoryRow } from "@/lib/hr-data";
import { EmployeeDirectory } from "./EmployeeDirectory";

type ServiceOption = { id: string; name: string };

/** Party row shape expected by PartiesEditor (structurally typed here since
 *  the master-data client doesn't export its internal Party type). */
type PartyRow = {
  id: string;
  name: string;
  group: "Candidate" | "Vendor";
  txTypes: "Revenue" | "Expense" | "Both";
  email: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  txCount: number;
  services: ServiceOption[];
  sourceId: string | null;
  sourceLabel: string | null;
};

/**
 * Finance "Parties" page body: a segmented switch between the existing
 * Candidates & Vendors editor (full CRUD, unchanged) and a read-only Employees
 * directory. The "+ Add party" action only applies to — and only shows on —
 * the Candidates & Vendors tab; there is intentionally no add/edit for
 * employees here (managed in HR).
 */
export function FinancePartiesView({
  parties,
  services,
  sources,
  employees,
}: {
  parties: PartyRow[];
  services: ServiceOption[];
  sources: SourceOption[];
  employees: EmployeeDirectoryRow[];
}) {
  const [tab, setTab] = useState<"parties" | "employees">("parties");

  const tabs = [
    { key: "parties" as const, label: "Candidates & Vendors", count: parties.length },
    { key: "employees" as const, label: "Employees", count: employees.length },
  ];

  return (
    <div className="space-y-lg">
      <div className="flex flex-wrap items-center gap-xs">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={
                "px-md py-sm rounded-lg text-label-sm transition " +
                (active
                  ? "bg-primary text-on-primary font-bold"
                  : "text-on-surface-variant hover:bg-surface-container")
              }
            >
              {t.label}
              <span className={"ml-xs " + (active ? "opacity-80" : "opacity-60")}>{t.count}</span>
            </button>
          );
        })}
        {tab === "parties" && (
          <span className="ml-auto">
            <NewPartyButton services={services} sources={sources} />
          </span>
        )}
      </div>

      {tab === "parties" ? (
        <PartiesEditor
          services={services}
          sources={sources}
          basePath="/finance/parties"
          parties={parties}
        />
      ) : (
        <EmployeeDirectory employees={employees} />
      )}
    </div>
  );
}
