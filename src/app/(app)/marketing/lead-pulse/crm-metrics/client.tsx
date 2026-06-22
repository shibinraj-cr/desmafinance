// Read-only comparison view: CRM-sourced metrics next to the daily-entry
// numbers. Server-rendered (no client interactivity beyond the GET month form).

type FunnelRow = {
  displayName: string;
  role: string;
  dailyLeads: number;
  dailyWon: number;
  dailyConv: number | null;
  crmLeads: number;
  crmWon: number;
  crmConv: number | null;
  crmLost: number;
};
type MatrixRow = {
  displayName: string;
  cells: { groupName: string; target: number; dailyActual: number; crmActual: number }[];
};

const fmtPct = (p: number | null) => (p == null ? "—" : `${p}%`);

export function CrmMetricsCompare({
  year,
  month,
  monthLabel,
  funnelRows,
  services,
  matrixRows,
}: {
  year: number;
  month: number;
  monthLabel: string;
  funnelRows: FunnelRow[];
  services: Array<{ id: string; name: string }>;
  matrixRows: MatrixRow[];
}) {
  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header>
        <h1 className="text-[30px] font-bold tracking-tight">CRM Metrics (Beta)</h1>
        <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          {monthLabel} · CRM-sourced numbers shown next to the daily entry, for validation before the cutover.
        </p>
      </header>

      <div
        className="rounded-[12px] p-[12px] border text-[13px]"
        style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)" }}
      >
        <strong style={{ color: "var(--lp-on-surface)" }}>Phase 1 — comparison only.</strong>{" "}
        The daily entry is still the source of truth for the live dashboards. <strong>CRM</strong> columns come from{" "}
        <em>leads assigned</em> (assignment date) and <em>enrollments</em> (CRM Enroll → closed_won). Differences are expected
        while not every close is entered as a CRM enrollment yet.
      </div>

      <form
        action="/marketing/lead-pulse/crm-metrics"
        method="get"
        className="flex flex-wrap items-center gap-[8px] rounded-[12px] p-[12px] border"
        style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
      >
        <select name="year" defaultValue={String(year)} className="h-[36px] px-[10px] rounded-[8px] text-[13px]">
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select name="month" defaultValue={String(month)} className="h-[36px] px-[10px] rounded-[8px] text-[13px]">
          {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
        <button type="submit" className="h-[36px] px-[14px] rounded-[8px] text-[13px] font-semibold" style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}>
          Apply
        </button>
      </form>

      {/* Funnel by BDE */}
      <section className="rounded-[12px] border overflow-hidden" style={{ borderColor: "var(--lp-outline-variant)" }}>
        <div className="px-[16px] py-[10px] text-[13px] font-semibold" style={{ backgroundColor: "var(--lp-surface-container)" }}>
          Leads → Enrollments by BDE
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr style={{ color: "var(--lp-on-surface-variant)" }}>
                <Th left>BDE</Th>
                <Th>Role</Th>
                <Th>Leads (daily)</Th>
                <Th>Leads (CRM)</Th>
                <Th>Won (daily)</Th>
                <Th>Won (CRM)</Th>
                <Th>Conv% (daily)</Th>
                <Th>Conv% (CRM)</Th>
                <Th>Lost (CRM)</Th>
              </tr>
            </thead>
            <tbody>
              {funnelRows.length === 0 ? (
                <tr><td colSpan={9} className="px-[16px] py-[16px] text-center" style={{ color: "var(--lp-on-surface-variant)" }}>No active BDEs.</td></tr>
              ) : (
                funnelRows.map((r) => (
                  <tr key={r.displayName} style={{ borderTop: "1px solid var(--lp-outline-variant)" }}>
                    <Td left strong>{r.displayName}</Td>
                    <Td>{r.role.toUpperCase()}</Td>
                    <Td>{r.dailyLeads}</Td>
                    <Td highlight>{r.crmLeads}</Td>
                    <Td>{r.dailyWon}</Td>
                    <Td highlight>{r.crmWon}</Td>
                    <Td>{fmtPct(r.dailyConv)}</Td>
                    <Td highlight>{fmtPct(r.crmConv)}</Td>
                    <Td>{r.crmLost}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Service targets — daily vs CRM actuals */}
      <section className="rounded-[12px] border overflow-hidden" style={{ borderColor: "var(--lp-outline-variant)" }}>
        <div className="px-[16px] py-[10px] text-[13px] font-semibold" style={{ backgroundColor: "var(--lp-surface-container)" }}>
          L2 Service Targets — actuals (target · daily · CRM)
        </div>
        {services.length === 0 || matrixRows.length === 0 ? (
          <div className="px-[16px] py-[16px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            No L2 BDEs / service groups for this month.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr style={{ color: "var(--lp-on-surface-variant)" }}>
                  <Th left>BDE</Th>
                  {services.map((g) => <Th key={g.id}>{g.name}</Th>)}
                </tr>
              </thead>
              <tbody>
                {matrixRows.map((row) => (
                  <tr key={row.displayName} style={{ borderTop: "1px solid var(--lp-outline-variant)" }}>
                    <Td left strong>{row.displayName}</Td>
                    {row.cells.map((c, i) => (
                      <Td key={i}>
                        <span style={{ color: "var(--lp-on-surface-variant)" }}>{c.target}</span>
                        {" · "}
                        <span>{c.dailyActual}</span>
                        {" · "}
                        <span style={{ color: c.crmActual !== c.dailyActual ? "var(--lp-primary)" : undefined, fontWeight: c.crmActual !== c.dailyActual ? 700 : undefined }}>
                          {c.crmActual}
                        </span>
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Th({ children, left }: { children?: React.ReactNode; left?: boolean }) {
  return (
    <th className={"px-[12px] py-[8px] text-[11px] uppercase tracking-wider font-semibold " + (left ? "text-left" : "text-center")}>
      {children}
    </th>
  );
}
function Td({ children, left, strong, highlight }: { children?: React.ReactNode; left?: boolean; strong?: boolean; highlight?: boolean }) {
  return (
    <td
      className={"px-[12px] py-[8px] " + (left ? "text-left" : "text-center")}
      style={{ fontWeight: strong ? 600 : undefined, color: highlight ? "var(--lp-primary)" : undefined }}
    >
      {children}
    </td>
  );
}
