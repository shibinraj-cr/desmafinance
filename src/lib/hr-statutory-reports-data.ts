import { prisma } from "./prisma";
import { structureForMonth } from "./hr-data";
import { isTraineeDesignation } from "./hr-salary-engine";
import {
  deriveEcrRow,
  deriveEsiRow,
  ESI_GROSS_CEILING,
  type EcrRow,
  type EsiRow,
  type StatutoryLineInput,
} from "./hr-statutory-reports";

export type StatutoryReportData = {
  run: { id: string; monthKey: string; status: string };
  ecr: EcrRow[];
  esi: EsiRow[];
  /** PF members on this run with no UAN on file (blocks a clean ECR upload). */
  missingUan: { employeeId: string; empCode: string; name: string }[];
  /** ESI members on this run with no IP number on file. */
  missingIp: { employeeId: string; empCode: string; name: string }[];
};

/**
 * Assemble both statutory returns for one salary run from its FROZEN lines.
 *
 * Membership cannot be read off a stored line alone — an ESI member with an
 * all-LOP month deducts ₹0 yet must still be filed with 0 days — so each
 * line's ESI/PF applicability is re-derived exactly the way computeSalaryRun
 * decided it: the salary structure in force for the month, overridden to
 * "off" for trainees. A nonzero stored deduction still forces inclusion, so a
 * later structure edit can never drop someone who actually contributed.
 */
export async function getStatutoryReportData(runId: string): Promise<StatutoryReportData | null> {
  const run = await prisma.hrSalaryRun.findUnique({
    where: { id: runId },
    include: {
      lines: {
        include: {
          employee: {
            select: {
              id: true,
              empCode: true,
              name: true,
              uan: true,
              esiIpNumber: true,
              epsExempt: true,
              designation: true,
              designationRef: { select: { name: true } },
            },
          },
        },
        orderBy: { employee: { name: "asc" } },
      },
    },
  });
  if (!run) return null;

  const ecr: EcrRow[] = [];
  const esi: EsiRow[] = [];
  const missingUan: StatutoryReportData["missingUan"] = [];
  const missingIp: StatutoryReportData["missingIp"] = [];

  for (const line of run.lines) {
    const e = line.employee;
    const isTrainee =
      isTraineeDesignation(e.designationRef?.name) || isTraineeDesignation(e.designation);
    const structure = isTrainee ? null : await structureForMonth(e.id, run.monthKey);

    const gross = Number(line.monthlySalary);
    const esiMember =
      Number(line.esiEmployee) > 0 ||
      (!!structure && structure.esiApplicable && gross <= ESI_GROSS_CEILING);
    const pfMember = Number(line.pfTotal) > 0 || (!!structure && structure.pfApplicable);
    if (!esiMember && !pfMember) continue;

    const input: StatutoryLineInput = {
      employeeId: e.id,
      empCode: e.empCode,
      name: e.name,
      uan: e.uan,
      esiIpNumber: e.esiIpNumber,
      epsExempt: e.epsExempt,
      salaryBeforeEsi: Number(line.salaryBeforeEsi),
      basicAfterLop: Number(line.basicAfterLop),
      daysAttended: Number(line.daysAttended),
      totalLeaveForLop: Number(line.totalLeaveForLop),
      pfEmployee: Number(line.pfEmployee),
      pfEmployer: Number(line.pfEmployer),
      pfWage: Number(line.pfWage),
      pfEmployerEpf: Number(line.pfEmployerEpf),
      pfEmployerEps: Number(line.pfEmployerEps),
      pfDetail: (line.pfDetail as StatutoryLineInput["pfDetail"]) ?? null,
    };

    if (pfMember) {
      ecr.push(deriveEcrRow(input));
      if (!input.uan?.trim()) missingUan.push({ employeeId: e.id, empCode: e.empCode, name: e.name });
    }
    if (esiMember) {
      esi.push(deriveEsiRow(input));
      if (!input.esiIpNumber?.trim()) missingIp.push({ employeeId: e.id, empCode: e.empCode, name: e.name });
    }
  }

  return {
    run: { id: run.id, monthKey: run.monthKey, status: run.status },
    ecr,
    esi,
    missingUan,
    missingIp,
  };
}
