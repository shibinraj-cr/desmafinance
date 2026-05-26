import type { SlipPayload } from "@/lib/hr-salary-slip";
import { inr } from "@/lib/format";

/**
 * Pure-presentation salary slip — laid out for A4 print. Used both
 * for HR's per-employee download and the employee's ESS payslip view.
 *
 * Print-to-PDF works out of the box because we use semantic block
 * elements with print-friendly CSS (avoid colours that don't render,
 * keep borders, force page break per slip).
 */
export function SalarySlip({ payload }: { payload: SlipPayload }) {
  const totalEarnings = payload.earnings.reduce((s, r) => s + r.amount, 0);
  const totalDeductions = payload.deductions.reduce((s, r) => s + r.amount, 0);
  return (
    <article
      className="bg-white text-black border border-gray-400 max-w-[800px] mx-auto p-8 print:border-0 print:shadow-none print:mx-0 print:max-w-full"
      style={{ pageBreakAfter: "always" }}
    >
      <header className="flex items-start justify-between border-b border-gray-400 pb-4 mb-4">
        <div>
          <h1 className="text-xl font-extrabold">{payload.employer.name}</h1>
          {payload.employer.address && (
            <p className="text-sm text-gray-600">{payload.employer.address}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-sm uppercase tracking-wider text-gray-600">Salary Slip</p>
          <p className="text-lg font-bold">{payload.meta.monthKey}</p>
          <p className="text-xs text-gray-600">{payload.meta.cycleLabel}</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm mb-4">
        <KV k="Employee" v={`${payload.employee.empCode} · ${payload.employee.name}`} />
        <KV k="Designation" v={payload.employee.designation ?? "—"} />
        <KV k="Department" v={payload.employee.department ?? "—"} />
        <KV k="Date of Joining" v={payload.employee.joinDate ?? "—"} />
        <KV k="PAN" v={payload.employee.pan ?? "—"} />
        <KV k="Bank" v={payload.employee.bankName ?? "—"} />
        <KV
          k="A/c No."
          v={
            payload.employee.bankAccount
              ? payload.employee.bankAccount.slice(0, 2) + "••••" + payload.employee.bankAccount.slice(-4)
              : "—"
          }
        />
        <KV k="IFSC" v={payload.employee.bankIfsc ?? "—"} />
      </section>

      <section className="grid grid-cols-5 gap-x-2 text-xs mb-4 bg-gray-100 p-2 rounded">
        <Att label="Working days" value={payload.attendance.workingDays} />
        <Att label="Attended" value={payload.attendance.daysAttended} />
        <Att label="Paid leave" value={payload.attendance.paidLeave} />
        <Att label="Unpaid leave" value={payload.attendance.unpaidLeave} />
        <Att label="Half-day" value={payload.attendance.halfDay} />
      </section>

      <section className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <h2 className="font-bold border-b border-gray-300 pb-1 mb-2">Earnings</h2>
          <table className="w-full">
            <tbody>
              {payload.earnings.map((r, i) => (
                <tr key={i}>
                  <td className="py-1">{r.label}</td>
                  <td className="py-1 text-right tabular-nums">{inr(r.amount)}</td>
                </tr>
              ))}
              <tr className="border-t border-gray-300 font-bold">
                <td className="py-1">Total Earnings</td>
                <td className="py-1 text-right tabular-nums">{inr(totalEarnings)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="font-bold border-b border-gray-300 pb-1 mb-2">Deductions</h2>
          <table className="w-full">
            <tbody>
              {payload.deductions.map((r, i) => (
                <tr key={i}>
                  <td className="py-1">{r.label}</td>
                  <td className="py-1 text-right tabular-nums">{inr(r.amount)}</td>
                </tr>
              ))}
              <tr className="border-t border-gray-300 font-bold">
                <td className="py-1">Total Deductions</td>
                <td className="py-1 text-right tabular-nums">{inr(totalDeductions)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-t-2 border-gray-700 mt-4 pt-3 flex items-center justify-between">
        <p className="text-sm font-bold">NET PAY</p>
        <p className="text-2xl font-extrabold tabular-nums">{inr(payload.net)}</p>
      </section>

      {payload.notes && (
        <p className="text-xs text-gray-600 italic mt-3">Note: {payload.notes}</p>
      )}

      <footer className="mt-8 grid grid-cols-2 gap-8 text-xs text-gray-700">
        <div>
          <div className="h-12 border-b border-gray-400" />
          <p className="mt-1">Employee Signature</p>
        </div>
        <div className="text-right">
          <div className="h-12 border-b border-gray-400" />
          <p className="mt-1">Authorised Signatory</p>
        </div>
      </footer>

      <p className="text-[10px] text-gray-500 mt-6 text-center">
        This is a system-generated slip. Generated on{" "}
        {new Date(payload.meta.generatedAt).toLocaleString("en-IN")}.
      </p>
    </article>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <p>
      <span className="uppercase text-xs text-gray-600 tracking-wider">{k}: </span>
      <span className="font-semibold">{v}</span>
    </p>
  );
}

function Att({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-[10px] uppercase tracking-wider text-gray-600">{label}</p>
      <p className="font-bold tabular-nums">{value.toFixed(1)}</p>
    </div>
  );
}
