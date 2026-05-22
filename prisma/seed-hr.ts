/**
 * Seed HR static data:
 *   - Default leave policy (1/month, carry-forward)
 *   - Shifts A and B
 *   - Employees from `hr/Employee Details 2026.xlsx`
 *
 * Idempotent — safe to re-run. Run with:
 *   npm run db:seed-hr
 */
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import { parseHumanDate } from "../src/lib/hr-data";

const prisma = new PrismaClient();

const EMPLOYEE_XLSX = "/Volumes/DESMA/AntiGravity/DESMA FINANCE/hr/Employee Details 2026.xlsx";

const SHIFTS = [
  { code: "A", name: "Shift A — 09:00 to 17:30", startTime: "09:00", endTime: "17:30", graceMinutes: 10 },
  { code: "B", name: "Shift B — 09:30 to 18:00", startTime: "09:30", endTime: "18:00", graceMinutes: 10 },
];

const HEADER_MAP: Record<string, string> = {
  "sl no": "slNo",
  "name": "name",
  "dob": "dob",
  "designation & position": "designation",
  "designation": "designation",
  "department": "department",
  "shift": "shift",
  "half an hour concession (3 times in a month)": "halfHourConcession",
  "half an hour concession": "halfHourConcession",
  "email": "email",
  "official email": "officialEmail",
  "phone no": "phone",
  "phone": "phone",
  "emergency contact": "emergencyContact",
  "office number": "officeNumber",
  "address": "address",
  "highest education": "highestEducation",
  "marital status": "maritalStatus",
  "experience if any": "experienceNotes",
  "no of years": "yearsOfExperience",
  "aadhar": "aadhar",
  "pan": "pan",
  "account no": "accountNumber",
  "ifsc": "ifsc",
  "branch": "branch",
  "join date": "joinDate",
};

function buildHeaderMap(headers: string[]): { idx: Record<string, number>; bankNameIdx: number | null } {
  const idx: Record<string, number> = {};
  let nameSeen = false;
  let bankNameIdx: number | null = null;
  headers.forEach((h, i) => {
    const norm = String(h ?? "").trim().toLowerCase();
    if (!norm) return;
    if (norm === "name") {
      if (!nameSeen) {
        idx.name = i;
        nameSeen = true;
      } else {
        bankNameIdx = i;
      }
      return;
    }
    const mapped = HEADER_MAP[norm];
    if (mapped) idx[mapped] = i;
  });
  return { idx, bankNameIdx };
}

function pickShiftCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^([A-Z])\b/i);
  return m ? m[1].toUpperCase() : null;
}

async function main() {
  console.log("Seeding default leave policy…");
  await prisma.hrLeavePolicy.upsert({
    where: { name: "Default policy" },
    update: {},
    create: {
      name: "Default policy",
      monthlyAccrual: 1,
      annualEntitlement: 12,
      carryForward: true,
      isDefault: true,
    },
  });

  console.log("Seeding shifts…");
  const shiftsByCode = new Map<string, string>();
  for (const def of SHIFTS) {
    const sh = await prisma.hrShift.upsert({
      where: { code: def.code },
      update: { name: def.name, startTime: def.startTime, endTime: def.endTime, graceMinutes: def.graceMinutes },
      create: def,
    });
    shiftsByCode.set(sh.code, sh.id);
    console.log(`  ✓ ${sh.code}`);
  }

  console.log("\nReading Employee Details 2026.xlsx…");
  const wb = XLSX.read(readFileSync(EMPLOYEE_XLSX), { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  const { idx, bankNameIdx } = buildHeaderMap(rows[0] as string[]);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const slNoRaw = String(row[idx.slNo ?? 0] ?? "").trim();
    const name = String(row[idx.name] ?? "").trim();
    if (!slNoRaw && !name) continue;
    const slNo = Number(slNoRaw);
    if (!Number.isFinite(slNo) || !name) {
      skipped++;
      continue;
    }
    const empCode = String(slNo).padStart(4, "0");
    const shiftCode = pickShiftCode(idx.shift !== undefined ? String(row[idx.shift] ?? "") : "");
    const shiftId = shiftCode ? shiftsByCode.get(shiftCode) ?? null : null;
    const halfRaw = String(row[idx.halfHourConcession ?? -1] ?? "").trim().toLowerCase();
    const halfHourConcession = halfRaw === "yes" || halfRaw === "y" || halfRaw === "true";

    const data = {
      empCode,
      name,
      dob: parseHumanDate(String(row[idx.dob ?? -1] ?? "")),
      designation: String(row[idx.designation ?? -1] ?? "").trim() || null,
      department: String(row[idx.department ?? -1] ?? "").trim() || null,
      email: String(row[idx.email ?? -1] ?? "").trim() || null,
      officialEmail: String(row[idx.officialEmail ?? -1] ?? "").trim() || null,
      phone: String(row[idx.phone ?? -1] ?? "").trim() || null,
      emergencyContact: String(row[idx.emergencyContact ?? -1] ?? "").trim() || null,
      officeNumber: String(row[idx.officeNumber ?? -1] ?? "").trim() || null,
      address: String(row[idx.address ?? -1] ?? "").trim() || null,
      highestEducation: String(row[idx.highestEducation ?? -1] ?? "").trim() || null,
      maritalStatus: String(row[idx.maritalStatus ?? -1] ?? "").trim() || null,
      experienceNotes: String(row[idx.experienceNotes ?? -1] ?? "").trim() || null,
      yearsOfExperience: String(row[idx.yearsOfExperience ?? -1] ?? "").trim() || null,
      aadhar: String(row[idx.aadhar ?? -1] ?? "").trim() || null,
      pan: String(row[idx.pan ?? -1] ?? "").trim() || null,
      accountNumber: String(row[idx.accountNumber ?? -1] ?? "").trim() || null,
      ifsc: String(row[idx.ifsc ?? -1] ?? "").trim() || null,
      bankName: bankNameIdx !== null ? String(row[bankNameIdx] ?? "").trim() || null : null,
      branch: String(row[idx.branch ?? -1] ?? "").trim() || null,
      joinDate: parseHumanDate(String(row[idx.joinDate ?? -1] ?? "")),
      shiftId,
      halfHourConcession,
      active: true,
    };

    const existing = await prisma.employee.findUnique({ where: { empCode } });
    if (existing) {
      await prisma.employee.update({ where: { id: existing.id }, data });
      updated++;
      console.log(`  ↻ ${empCode} ${name}`);
    } else {
      await prisma.employee.create({ data });
      created++;
      console.log(`  ✓ ${empCode} ${name}`);
    }
  }
  console.log(`\nDone. created=${created} updated=${updated} skipped=${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
