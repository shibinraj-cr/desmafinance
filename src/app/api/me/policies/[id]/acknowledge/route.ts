import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";

const Schema = z.object({
  signatureName: z.string().min(1),
  signatureImage: z.string().nullable().optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const emp = await employeeForUser(userId);
  if (!emp) return NextResponse.json({ error: "no employee profile" }, { status: 400 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const policy = await prisma.hrPolicy.findUnique({ where: { id: params.id } });
  if (!policy || policy.status !== "published") {
    return NextResponse.json({ error: "policy not available" }, { status: 404 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent") ?? null;
  const ack = await prisma.hrPolicyAcknowledgement.upsert({
    where: { policyId_employeeId: { policyId: policy.id, employeeId: emp.id } },
    update: {
      signatureName: parsed.data.signatureName,
      signatureImage: parsed.data.signatureImage ?? null,
      ipAddress: ip,
      userAgent: ua,
    },
    create: {
      policyId: policy.id,
      employeeId: emp.id,
      signatureName: parsed.data.signatureName,
      signatureImage: parsed.data.signatureImage ?? null,
      ipAddress: ip,
      userAgent: ua,
    },
  });
  return NextResponse.json({ ack });
}
