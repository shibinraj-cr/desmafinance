"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard, Section } from "@/components/Cards";
import { inrCompact, inrFull } from "@/lib/format";
import { COHORT_DAYS, MIN_ENROLLMENTS_FOR_RATIO, fmtRoas, type MetaRoiReport, type Payback } from "@/lib/meta-roi";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// The ledger's own month style ("Nov-26"); "Nov 26" would read as a day.
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}-${m.slice(2, 4)}`;
const rs = (v: number) => inrFull(Math.round(v));
const opt = (v: number | null) => (v === null ? "—" : rs(v));
const n = (v: number) => v.toLocaleString("en-IN");

// Series colours: spend is the cost, the three cash layers share one hue family.
const C = { spend: "#5f6368", newSales: "#1c5cab", collections: "#4e8fd6", repeat: "#a9c8ee" };

function paybackText(p: Payback): string {
  if (!p) return "—";
  if (p.kind === "paid_back") return p.months === 0 ? `${monthName(p.month)} (same month)` : `${monthName(p.month)} (+${p.months} mo)`;
  return `Not yet, ${p.recoveredPct}% recovered`;
}

export function MetaRoiView({ report }: { report: MetaRoiReport }) {
  const t = report.total;
  const first = report.months[0]?.month;
  const last = report.months[report.months.length - 1]?.month;
  const anyManual = report.months.some((m) => m.manualSpend !== null);
  const chart = report.months.map((m) => ({
    name: monthName(m.month),
    Spend: Math.round(m.spend),
    "New sales": Math.round(m.newSales),
    Collections: Math.round(m.collections),
    "Repeat services": Math.round(m.repeatSales),
  }));

  return (
    <div className="p-margin space-y-lg">
      <p className="text-body-md text-on-surface-variant max-w-[900px]">
        Meta ad spend against the money Meta candidates paid, {first ? monthName(first) : ""}–{last ? monthName(last) : ""}. Meta means Meta lead
        forms, Insta / FB, WA API and any lead that came from a Meta ad. Money is Finance-approved ledger payments, net of GST, without partner
        commissions. Spend is the ledger&apos;s &ldquo;Digital Advertisement - Meta&rdquo;, dated when the card was charged, not when the ads ran.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-md">
        <KpiCard label="Meta ad spend" value={inrCompact(t.spend)} hint="From the ledger, as paid" />
        <KpiCard
          label="Meta cash, net of GST"
          value={inrCompact(t.cash)}
          tone="primary"
          hint={`New ${inrCompact(t.newSales)} · collections ${inrCompact(t.collections)} · repeat ${inrCompact(t.repeatSales)}${t.refunds ? ` · refunds −${inrCompact(t.refunds)}` : ""}`}
        />
        <KpiCard label="Cash ROAS" value={fmtRoas(t.cashRoas)} hint="All Meta cash ÷ spend. Mixes cohorts: older leads' collections land too" />
        <KpiCard label="New-sale ROAS" value={fmtRoas(t.newSaleRoas)} hint="First payments only ÷ spend" />
        <KpiCard
          label="New Meta enrollments"
          value={n(t.newEnrollments)}
          hint={`${n(t.verifiedEnrollments)} verified by Finance · ad cost per enrollment ${opt(t.costPerEnrollment)}${t.repeatEnrollments ? ` · ${n(t.repeatEnrollments)} repeat` : ""}`}
        />
        <KpiCard
          label="ROAS at 90 days"
          value={report.latest90 ? fmtRoas(report.latest90.roasAt[90]) : "—"}
          hint={report.latest90 ? `Leads from ${monthName(report.latest90.month)}: cash within 90 days of each lead ÷ that month's spend` : "No month is 90 days old yet"}
        />
      </div>

      <Section title="Spend and cash by month">
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e1e2e9" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v: number) => inrCompact(v)} tick={{ fontSize: 11 }} width={72} />
              <Tooltip formatter={(v: number) => rs(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Spend" fill={C.spend} stackId="spend" />
              <Bar dataKey="New sales" fill={C.newSales} stackId="cash" />
              <Bar dataKey="Collections" fill={C.collections} stackId="cash" />
              <Bar dataKey="Repeat services" fill={C.repeat} stackId="cash" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto -mx-lg mt-md">
          <table className="w-full text-body-md" data-testid="meta-roi-months">
            <thead className="bg-surface-container text-on-surface-variant">
              <tr>
                <Th>Month</Th>
                <Th right>Spend</Th>
                {anyManual && <Th right title="Lead Pulse's hand-entered Meta figure. For reference: the ROAS uses the ledger.">Lead Pulse figure</Th>}
                <Th right>New sales</Th>
                <Th right>Collections</Th>
                <Th right>Repeat</Th>
                <Th right>Refunds</Th>
                <Th right>Cash</Th>
                <Th right>Cash ROAS</Th>
                <Th right>New-sale ROAS</Th>
                <Th right>Meta leads</Th>
                <Th right>Cost / lead</Th>
                <Th right title="Enrolled on their enrollment date; in brackets, how many Finance has verified">New enrollments</Th>
                <Th right>Cost / enrollment</Th>
                <Th right>Repeat enrollments</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {[...report.months].reverse().map((m) => (
                <tr key={m.month}>
                  <Td>{monthName(m.month)}</Td>
                  <Td right>{rs(m.spend)}</Td>
                  {anyManual && <Td right muted>{m.manualSpend === null ? "—" : rs(m.manualSpend)}</Td>}
                  <Td right>{rs(m.newSales)}</Td>
                  <Td right>{rs(m.collections)}</Td>
                  <Td right>{rs(m.repeatSales)}</Td>
                  <Td right>{m.refunds ? `−${rs(m.refunds)}` : "—"}</Td>
                  <Td right strong>{rs(m.cash)}</Td>
                  <Td right strong>{fmtRoas(m.cashRoas)}</Td>
                  <Td right>{fmtRoas(m.newSaleRoas)}</Td>
                  <Td right>{n(m.leads)}</Td>
                  <Td right>{opt(m.costPerLead)}</Td>
                  <Td right>
                    {n(m.newEnrollments)}
                    {m.newEnrollments ? <span className="text-on-surface-variant"> ({n(m.verifiedEnrollments)})</span> : null}
                  </Td>
                  <Td right>{opt(m.costPerEnrollment)}</Td>
                  <Td right>{m.repeatEnrollments ? n(m.repeatEnrollments) : "—"}</Td>
                </tr>
              ))}
              <tr className="bg-surface-container-low font-semibold">
                <Td strong>Total</Td>
                <Td right strong>{rs(t.spend)}</Td>
                {anyManual && <Td right muted>—</Td>}
                <Td right strong>{rs(t.newSales)}</Td>
                <Td right strong>{rs(t.collections)}</Td>
                <Td right strong>{rs(t.repeatSales)}</Td>
                <Td right strong>{t.refunds ? `−${rs(t.refunds)}` : "—"}</Td>
                <Td right strong>{rs(t.cash)}</Td>
                <Td right strong>{fmtRoas(t.cashRoas)}</Td>
                <Td right strong>{fmtRoas(t.newSaleRoas)}</Td>
                <Td right strong>{n(t.leads)}</Td>
                <Td right strong>{opt(t.costPerLead)}</Td>
                <Td right strong>
                  {n(t.newEnrollments)} <span className="text-on-surface-variant font-normal">({n(t.verifiedEnrollments)})</span>
                </Td>
                <Td right strong>{opt(t.costPerEnrollment)}</Td>
                <Td right strong>{t.repeatEnrollments ? n(t.repeatEnrollments) : "—"}</Td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-caption text-on-surface-variant mt-sm">
          A month&apos;s cash ROAS mixes cohorts: collections from older leads land in a month with little spend and flatter it. Read it beside
          the view by the month the lead came in, below. Enrollments count on their enrollment date; money counts only once it is in the ledger.
        </p>
      </Section>

      <Section title="By the month the lead came in">
        <div className="overflow-x-auto -mx-lg">
          <table className="w-full text-body-md" data-testid="meta-roi-cohorts">
            <thead className="bg-surface-container text-on-surface-variant">
              <tr>
                <Th>Leads from</Th>
                <Th right>Leads</Th>
                <Th right>Enrolled</Th>
                <Th right>Spend that month</Th>
                {COHORT_DAYS.map((d) => (
                  <Th key={d} right title={`Cash paid within ${d} days of each lead, and that ÷ the month's spend`}>
                    {d} days
                  </Th>
                ))}
                <Th right>Cash to date</Th>
                <Th>Spend paid back</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {[...report.cohorts].reverse().map((c) => (
                <tr key={c.month}>
                  <Td>{monthName(c.month)}</Td>
                  <Td right>{n(c.leads)}</Td>
                  <Td right>{n(c.enrolled)}</Td>
                  <Td right>{rs(c.spend)}</Td>
                  {COHORT_DAYS.map((d) => (
                    <Td key={d} right>
                      {c.cashAt[d] === null ? (
                        <span className="text-on-surface-variant" title={`Not ${d} days old yet`}>
                          too young
                        </span>
                      ) : (
                        <>
                          {rs(c.cashAt[d]!)}
                          {c.roasAt[d] !== null && <span className="text-on-surface-variant"> · {fmtRoas(c.roasAt[d])}</span>}
                        </>
                      )}
                    </Td>
                  ))}
                  <Td right strong>{rs(c.cashToDate)}</Td>
                  <Td>{paybackText(c.payback)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-caption text-on-surface-variant mt-sm">
          Each candidate&apos;s money belongs to the month of their first lead, so a candidate who asked twice is counted once. Cohorts are compared
          at the same age: a month shows &ldquo;too young&rdquo; until every lead in it is that many days old.
        </p>
      </Section>

      <Section title="By campaign">
        {report.campaigns.length === 0 ? (
          <p className="py-md text-on-surface-variant">No Meta leads in these months.</p>
        ) : (
          <div className="overflow-x-auto -mx-lg">
            <table className="w-full text-body-md" data-testid="meta-roi-campaigns">
              <thead className="bg-surface-container text-on-surface-variant">
                <tr>
                  <Th>Campaign / form</Th>
                  <Th right>Leads</Th>
                  <Th right>Enrolled</Th>
                  <Th right>Cash to date</Th>
                  <Th right>Cash per enrollment</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {report.campaigns.slice(0, 50).map((c) => (
                  <tr key={c.campaign}>
                    <Td>{c.campaign}</Td>
                    <Td right>{n(c.leads)}</Td>
                    <Td right>{n(c.enrolled)}</Td>
                    <Td right>{rs(c.cash)}</Td>
                    <Td right>{c.cashPerEnrollment === null ? <span className="text-on-surface-variant">too few</span> : rs(c.cashPerEnrollment)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-caption text-on-surface-variant mt-sm">
          The ledger has no spend per campaign, so there is no ROAS per campaign until the Ads Manager export is imported. Fewer than{" "}
          {MIN_ENROLLMENTS_FOR_RATIO} enrollments show &ldquo;too few&rdquo;.
          {report.campaigns.length > 50 ? ` The top 50 of ${n(report.campaigns.length)} are shown.` : ""}
        </p>
      </Section>

      <Section title="Kept apart">
        <ul className="text-body-md text-on-surface-variant list-disc pl-lg space-y-xs" data-testid="meta-roi-apart">
          <li>
            <b className="text-on-surface">Possible Meta</b> (Instagram DM leads with no ad recorded): {rs(t.possibleCash)} cash
            {t.possibleEnrollments ? `, ${n(t.possibleEnrollments)} enrollment${t.possibleEnrollments === 1 ? "" : "s"}` : ""}. Not in any figure above.
          </li>
          <li>
            WA API leads count as Meta. {n(report.waApiWithoutAd)} of this period&apos;s Meta leads came in on WhatsApp with no ad recorded.
          </li>
          <li>Spend is as paid, GST included where Meta charged it. If the GST on ads is claimed back, every ROAS here is slightly understated.</li>
        </ul>
      </Section>
    </div>
  );
}

function Th({ children, right, title }: { children?: React.ReactNode; right?: boolean; title?: string }) {
  return (
    <th title={title} className={"py-sm px-md text-label-sm uppercase tracking-wide whitespace-nowrap " + (right ? "text-right" : "text-left")}>
      {children}
    </th>
  );
}

function Td({ children, right, strong, muted }: { children?: React.ReactNode; right?: boolean; strong?: boolean; muted?: boolean }) {
  return (
    <td
      className={
        "py-sm px-md whitespace-nowrap " +
        (right ? "text-right " : "") +
        (strong ? "font-semibold text-on-surface " : "") +
        (muted ? "text-on-surface-variant" : "")
      }
    >
      {children}
    </td>
  );
}
