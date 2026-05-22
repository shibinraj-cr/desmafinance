import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { parseHumanDate } from "@/lib/hr-data";

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
  return m ? m[1].toUpperCase() : s.slice(0, 4).toUpperCase();
}

export async function POST(req: Request) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

  if (rows.length < 2) return NextResponse.json({ error: "empty sheet" }, { status: 400 });
  const headerRow = rows[0] as string[];
  const { idx, bankNameIdx } = buildHeaderMap(headerRow);

  const SHIFT_DEFS: Record<string, { code: string; name: string; startTime: string; endTime: string }> = {
    A: { code: "A", name: "Shift A — 09:00 to 17:30", startTime: "09:00", endTime: "17:30" },
    B: { code: "B", name: "Shift B — 09:30 to 18:00", startTime: "09:30", endTime: "18:00" },
  };
  const shiftsByCode = new Map<string, string>();
  for (const code of Object.keys(SHIFT_DEFS)) {
    const def = SHIFT_DEFS[code];
    const sh = await prisma.hrShift.upsert({
      where: { code },
      update: {},
      create: def,
    });
    shiftsByCode.set(code, sh.id);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const slNoRaw = String(row[idx.slNo ?? 0] ?? "").trim();
    const name = String(row[idx.name] ?? "").trim();
    if (!name) {
      if (!slNoRaw) continue;
      skipped++;
      continue;
    }
    const slNo = Number(slNoRaw);
    if (!Number.isFinite(slNo)) {
      skipped++;
      continue;
    }
    const empCode = String(slNo).padStart(4, "0");
    const shiftCode = pickShiftCode(idx.shift !== undefined ? String(row[idx.shift] ?? "") : "");
    const shiftId = shiftCode && shiftsByCode.get(shiftCode) ? shiftsByCode.get(shiftCode)! : null;
    const halfRaw = String(row[idx.halfHourConcession ?? -1] ?? "").trim().toLowerCase();
    const halfHourConcession = halfRaw === "yes" || halfRaw === "y" || halfRaw === "true";

    const data = {
      empCode,
      name,
      dob: parseHumanDate(String(row[idx.dob ?? -1] ?? "")),
      designation: idx.designation !== undefined ? String(row[idx.designation] ?? "").trim() || null : null,
      department: idx.department !== undefined ? String(row[idx.department] ?? "").trim() || null : null,
      email: idx.email !== undefined ? String(row[idx.email] ?? "").trim() || null : null,
      officialEmail: idx.officialEmail !== undefined ? String(row[idx.officialEmail] ?? "").trim() || null : null,
      phone: idx.phone !== undefined ? String(row[idx.phone] ?? "").trim() || null : null,
      emergencyContact: idx.emergencyContact !== undefined ? String(row[idx.emergencyContact] ?? "").trim() || null : null,
      officeNumber: idx.officeNumber !== undefined ? String(row[idx.officeNumber] ?? "").trim() || null : null,
      address: idx.address !== undefined ? String(row[idx.address] ?? "").trim() || null : null,
      highestEducation: idx.highestEducation !== undefined ? String(row[idx.highestEducation] ?? "").trim() || null : null,
      maritalStatus: idx.maritalStatus !== undefined ? String(row[idx.maritalStatus] ?? "").trim() || null : null,
      experienceNotes: idx.experienceNotes !== undefined ? String(row[idx.experienceNotes] ?? "").trim() || null : null,
      yearsOfExperience: idx.yearsOfExperience !== undefined ? String(row[idx.yearsOfExperience] ?? "").trim() || null : null,
      aadhar: idx.aadhar !== undefined ? String(row[idx.aadhar] ?? "").trim() || null : null,
      pan: idx.pan !== undefined ? String(row[idx.pan] ?? "").trim() || null : null,
      accountNumber: idx.accountNumber !== undefined ? String(row[idx.accountNumber] ?? "").trim() || null : null,
      ifsc: idx.ifsc !== undefined ? String(row[idx.ifsc] ?? "").trim() || null : null,
      bankName: bankNameIdx !== null ? String(row[bankNameIdx] ?? "").trim() || null : null,
      branch: idx.branch !== undefined ? String(row[idx.branch] ?? "").trim() || null : null,
      joinDate: parseHumanDate(String(row[idx.joinDate ?? -1] ?? "")),
      shiftId,
      halfHourConcession,
      active: true,
    } as const;

    try {
      const existing = await prisma.employee.findUnique({ where: { empCode } });
      if (existing) {
        await prisma.employee.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.employee.create({ data });
        created++;
      }
    } catch (err) {
      errors.push(`${name}: ${(err as Error).message}`);
      skipped++;
    }
  }

  await prisma.hrAuditLog.create({
    data: {
      eventType: "employees_imported",
      metadata: { created, updated, skipped, errors: errors.slice(0, 20) },
    },
  });

  return NextResponse.json({ created, updated, skipped, errors });
}
