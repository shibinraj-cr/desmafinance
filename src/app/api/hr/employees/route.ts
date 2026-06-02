import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";
import { parseHumanDate } from "@/lib/hr-data";

const Schema = z.object({
  empCode: z.string().min(1).max(16),
  name: z.string().min(1),
  dob: z.string().nullable().optional(),
  designation: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  officialEmail: z.string().email().nullable().optional().or(z.literal("")),
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
  halfHourConcession: z.boolean().default(false),
  active: z.boolean().default(true),
});

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const employees = await prisma.employee.findMany({
    orderBy: [{ active: "desc" }, { joinDate: "asc" }, { name: "asc" }],
    include: { shift: true },
  });
  return NextResponse.json({ employees });
}

export async function POST(req: Request) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  try {
    const employee = await prisma.employee.create({
      data: {
        empCode: d.empCode,
        name: d.name,
        dob: parseHumanDate(d.dob),
        designation: d.designation || null,
        department: d.department || null,
        email: d.email || null,
        officialEmail: d.officialEmail || null,
        phone: d.phone || null,
        emergencyContact: d.emergencyContact || null,
        officeNumber: d.officeNumber || null,
        address: d.address || null,
        highestEducation: d.highestEducation || null,
        maritalStatus: d.maritalStatus || null,
        experienceNotes: d.experienceNotes || null,
        yearsOfExperience: d.yearsOfExperience || null,
        aadhar: d.aadhar || null,
        pan: d.pan || null,
        accountNumber: d.accountNumber || null,
        ifsc: d.ifsc || null,
        bankName: d.bankName || null,
        branch: d.branch || null,
        joinDate: parseHumanDate(d.joinDate),
        shiftId: d.shiftId || null,
        halfHourConcession: d.halfHourConcession,
        active: d.active,
      },
    });
    return NextResponse.json({ employee });
  } catch (e) {
    // P2002 = unique constraint violation. empCode is the only user-facing
    // unique column on create, so surface a clear, actionable message instead
    // of letting it bubble up as an opaque 500 ("create failed" in the UI).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: `Employee code "${d.empCode}" is already in use` },
        { status: 409 },
      );
    }
    throw e;
  }
}
