import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canDownloadAxis } from "@/lib/hr-rbac";

const HEADER_ROW = [
  "Debit Account Number  \n(Mandatory)",
  "Transaction Amount  \n(Mandatory)",
  "Transaction Currency \n(Non-Mandatory)",
  "Beneficiary Name  \n(Mandatory)",
  "Beneficiary Account Number  \n(Mandatory)",
  "Beneficiary IFSC Code  \n(Mandatory)",
  "Transaction Date  \n(Mandatory)",
  "Payment Mode  \n(Mandatory)",
  "Customer Reference Number  \n(Mandatory)",
  "Beneficiary Nickname/Code  \n(Mandatory)",
  "Bank Account Type \n(Non-Mandatory)",
  "Debit Narration \n(Non-Mandatory)",
  "Credit Narration \n(Non-Mandatory)",
  "Beneficiary Address 1 \n(Non-Mandatory)",
  "Beneficiary Address 2 \n(Non-Mandatory)",
  "Beneficiary Address 3 \n(Non-Mandatory)",
  "Beneficiary City \n(Non-Mandatory)",
  "Beneficiary State \n(Non-Mandatory)",
  "Beneficiary Pin Code \n(Non-Mandatory)",
  "Beneficiary Bank Name \n(Non-Mandatory)",
  "Beneficiary Email address 1 \n(Non-Mandatory)",
  "Beneficiary Email address 2 \n(Non-Mandatory)",
  "Beneficiary Mobile Number \n(Non-Mandatory)",
  "Add Info1 \n(Non-Mandatory)",
];

function inferPaymentMode(ifsc: string | null): string {
  if (!ifsc) return "NEFT";
  if (ifsc.toUpperCase().startsWith("UTIB")) return "IFT";
  return "NEFT";
}

function inferAccountType(_ifsc: string | null): string {
  return "SB";
}

function fmtDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = d.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}

function pickDebitAccount(): string {
  return process.env.AXIS_DEBIT_ACCOUNT ?? "";
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canDownloadAxis(perms)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const run = await prisma.hrSalaryRun.findUnique({
    where: { id: params.id },
    include: {
      lines: {
        include: { employee: { select: { name: true, empCode: true, email: true, officialEmail: true, phone: true } } },
        orderBy: { employee: { empCode: "asc" } },
      },
    },
  });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (run.status !== "hr_approved" && run.status !== "finance_paid") {
    return NextResponse.json(
      { error: "salary run is still in draft — HR must approve before download" },
      { status: 400 },
    );
  }

  const [yStr, mStr] = run.monthKey.split("-");
  const txDate = new Date(Date.UTC(+yStr, +mStr - 1, 30));

  const rows: (string | number)[][] = [HEADER_ROW];
  const debitAcct = pickDebitAccount();

  for (const line of run.lines) {
    const amount = Number(line.netSalary) + Number(line.adjustments);
    if (amount <= 0) continue;
    if (!line.bankAccount || !line.bankIfsc) continue;
    rows.push([
      debitAcct,
      amount.toFixed(2),
      "INR",
      line.employee.name,
      line.bankAccount,
      line.bankIfsc,
      fmtDate(txDate),
      inferPaymentMode(line.bankIfsc),
      `SAL-${run.monthKey}-${line.employee.empCode}`,
      line.employee.empCode,
      inferAccountType(line.bankIfsc),
      `Salary ${run.monthKey}`,
      `Salary ${run.monthKey} ${line.employee.name}`,
      "",
      "",
      "",
      "",
      "",
      "",
      line.bankName ?? "",
      line.employee.officialEmail ?? line.employee.email ?? "",
      "",
      line.employee.phone ?? "",
      `Run ${run.id.slice(0, 8)}`,
    ]);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Default - Across All Banks");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const filename = `axis-salary-${run.monthKey}.xlsx`;
  await prisma.hrSalaryRun.update({
    where: { id: run.id },
    data: { axisExportName: filename, axisExportedAt: new Date() },
  });
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "axis_export_downloaded",
      entityType: "HrSalaryRun",
      entityId: run.id,
      metadata: { monthKey: run.monthKey, filename, lines: rows.length - 1 },
    },
  });

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
