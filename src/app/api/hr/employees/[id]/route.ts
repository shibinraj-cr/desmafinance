import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { parseHumanDate } from "@/lib/hr-data";
import { changeEmployeeShift } from "@/lib/hr-shift";
import { recomputeAfterShiftChange } from "@/lib/hr-attendance-ingest";

// A shift change here re-derives stored attendance cycle by cycle.
export const maxDuration = 120;

const Patch = z.object({
  empCode: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  dob: z.string().nullable().optional(),
  designation: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  officialEmail: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  emergencyContact: z.string().nullable().optional(),
  officeNumber: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  highestEducation: z.string().nullable().optional(),
  maritalStatus: z.string().nullable().optional(),
  experienceNotes: z.string().nullable().optional(),
  yearsOfExperience: z.string().nullable().optional(),
  aadhar: z.string().nullable().optional(),
  pan: z.string().nullable().optional(),
  accountNumber: z.string().nullable().optional(),
  ifsc: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  joinDate: z.string().nullable().optional(),
  shiftId: z.string().nullable().optional(),
  halfHourConcession: z.boolean().optional(),
  active: z.boolean().optional(),
  userId: z.string().nullable().optional(),
  designationId: z.string().nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Patch.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  const data: Record<string, unknown> = { ...d };
  if ("dob" in d) data.dob = parseHumanDate(d.dob ?? null);
  if ("joinDate" in d) data.joinDate = parseHumanDate(d.joinDate ?? null);
  for (const k of [
    "email", "officialEmail", "phone", "emergencyContact", "officeNumber",
    "address", "designation", "department", "highestEducation", "maritalStatus",
    "experienceNotes", "yearsOfExperience", "aadhar", "pan", "accountNumber",
    "ifsc", "bankName", "branch", "shiftId", "userId", "designationId",
  ]) {
    if (data[k] === "") data[k] = null;
  }
  // The shift is NOT written straight onto the employee row: that would make
  // every past attendance day re-derive against the new shift. Route it through
  // the dated assignment timeline instead (effective today), then re-derive the
  // days that timeline actually changed.
  const shiftRequested = "shiftId" in data;
  const nextShiftId = (data.shiftId as string | null) ?? null;
  delete data.shiftId;

  let shiftChange: {
    effectiveFrom: string;
    seededHistory: boolean;
    cycles: { monthKey: string; updatedDays: number; skipped: string | null }[];
  } | null = null;
  if (shiftRequested) {
    const res = await changeEmployeeShift({
      employeeId: params.id,
      shiftId: nextShiftId,
      reason: "Changed from employee record",
      createdById: userId ?? null,
    });
    if (res.changed) {
      const rc = await recomputeAfterShiftChange({
        employeeId: params.id,
        from: res.effectiveFrom,
        actorUserId: userId ?? null,
      });
      shiftChange = {
        effectiveFrom: res.effectiveFrom.toISOString().slice(0, 10),
        seededHistory: res.seededHistory,
        cycles: rc.cycles,
      };
    }
  }

  const employee = await prisma.employee.update({ where: { id: params.id }, data });
  return NextResponse.json({ employee, shiftChange });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const employee = await prisma.employee.update({
    where: { id: params.id },
    data: { active: false },
  });
  return NextResponse.json({ employee });
}
