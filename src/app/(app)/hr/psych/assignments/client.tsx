"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Section } from "@/components/Cards";

type Row = {
  empId: string;
  empCode: string;
  name: string;
  designation: string | null;
  department: string | null;
  assignmentId: string | null;
  status: string;
  expiresAt: string | null;
  assignedAt: string | null;
  submittedAt: string | null;
  hasReport: boolean;
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  NOT_ASSIGNED: { label: "Not assigned", cls: "text-on-surface-variant" },
  ASSIGNED: { label: "Pending", cls: "text-blue-700" },
  IN_PROGRESS: { label: "In progress", cls: "text-amber-700" },
  COMPLETED: { label: "Completed", cls: "text-green-700" },
  EXPIRED: { label: "Expired", cls: "text-red-700" },
  INVALIDATED: { label: "Invalidated", cls: "text-on-surface-variant" },
};

export function AssignmentsClient({
  rows,
  testId,
  canEdit,
}: {
  rows: Row[];
  testId: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [query, setQuery] = useState("");
  const [linkModal, setLinkModal] = useState<{
    name: string;
    url: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = rows.filter((r) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.empCode.toLowerCase().includes(q) ||
      (r.department ?? "").toLowerCase().includes(q) ||
      (r.designation ?? "").toLowerCase().includes(q)
    );
  });

  async function assign(empId: string, name: string) {
    if (!testId) {
      setError("No active test cycle — seed one first.");
      return;
    }
    setError(null);
    const res = await fetch("/api/hr/psych/assign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ employeeId: empId, testId }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(j.error || "assign failed");
      return;
    }
    setLinkModal({ name, url: j.url, expiresAt: j.expiresAt });
    start(() => router.refresh());
  }

  async function reassign(assignmentId: string, name: string) {
    if (!confirm("Invalidate the existing link and issue a fresh one?")) return;
    setError(null);
    const res = await fetch(`/api/hr/psych/reassign/${assignmentId}`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(j.error || "reassign failed");
      return;
    }
    setLinkModal({ name, url: j.url, expiresAt: j.expiresAt });
    start(() => router.refresh());
  }

  return (
    <>
      <Section title="">
        <div className="flex flex-wrap items-center gap-sm mb-md">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, code, dept…"
            className="flex-1 min-w-[200px] px-sm py-sm rounded border border-outline-variant bg-surface"
          />
        </div>
        {error && (
          <div className="mb-md text-error text-label-sm">{error}</div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-label-sm">
            <thead className="text-left text-on-surface-variant border-b border-outline-variant">
              <tr>
                <th className="py-sm pr-md">#</th>
                <th className="py-sm pr-md">Name</th>
                <th className="py-sm pr-md">Designation</th>
                <th className="py-sm pr-md">Department</th>
                <th className="py-sm pr-md">Status</th>
                <th className="py-sm pr-md">Expires</th>
                <th className="py-sm pr-md text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const s = STATUS_LABEL[r.status] ?? STATUS_LABEL.NOT_ASSIGNED;
                return (
                  <tr key={r.empId} className="border-b border-outline-variant last:border-0">
                    <td className="py-sm pr-md text-on-surface-variant">{r.empCode}</td>
                    <td className="py-sm pr-md font-semibold">{r.name}</td>
                    <td className="py-sm pr-md">{r.designation ?? "—"}</td>
                    <td className="py-sm pr-md">{r.department ?? "—"}</td>
                    <td className={"py-sm pr-md " + s.cls}>{s.label}</td>
                    <td className="py-sm pr-md text-on-surface-variant">
                      {r.expiresAt ? r.expiresAt.slice(0, 16).replace("T", " ") : "—"}
                    </td>
                    <td className="py-sm pr-md text-right whitespace-nowrap">
                      {canEdit && r.status === "NOT_ASSIGNED" && (
                        <button
                          onClick={() => assign(r.empId, r.name)}
                          className="text-blue-700 underline"
                        >
                          Assign
                        </button>
                      )}
                      {canEdit && (r.status === "ASSIGNED" || r.status === "IN_PROGRESS" || r.status === "EXPIRED") && r.assignmentId && (
                        <button
                          onClick={() => reassign(r.assignmentId!, r.name)}
                          className="text-blue-700 underline"
                        >
                          Reassign
                        </button>
                      )}
                      {r.hasReport && (
                        <Link
                          href={`/hr/psych/reports/${r.empId}`}
                          className="ml-sm text-green-700 underline"
                        >
                          View report
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-lg text-center text-on-surface-variant">
                    No employees match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {linkModal && (
        <div
          className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-md"
          onClick={() => setLinkModal(null)}
        >
          <div
            className="bg-surface rounded-xl shadow-2xl max-w-xl w-full p-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-h3 mb-sm">Assignment link — {linkModal.name}</h3>
            <p className="text-on-surface-variant text-label-sm mb-md">
              Copy this link and send it to the employee (WhatsApp, SMS, email — your choice). For
              security we don&apos;t store the raw URL, so save it now if you need to send it later.
              The link expires at{" "}
              <span className="font-bold">
                {new Date(linkModal.expiresAt).toLocaleString()}
              </span>
              .
            </p>
            <div className="flex gap-sm items-stretch mb-md">
              <input
                readOnly
                value={linkModal.url}
                className="flex-1 px-sm py-sm rounded border border-outline-variant bg-surface-container font-mono text-label-sm"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(linkModal.url).catch(() => {});
                }}
                className="px-md py-sm rounded bg-primary text-on-primary font-bold"
              >
                Copy
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setLinkModal(null)}
                className="px-md py-sm rounded border border-outline-variant"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
