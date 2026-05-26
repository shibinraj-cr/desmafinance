import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { generateEssCredentials } from "@/lib/hr-ess-credentials";

const Schema = z.object({
  channel: z.enum(["email", "whatsapp", "both"]).nullable().optional(),
  roleId: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: { employeeId: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const result = await generateEssCredentials({
      employeeId: params.employeeId,
      actorUserId: userId ?? null,
      channel: parsed.data.channel ?? null,
      roleId: parsed.data.roleId ?? null,
      notes: parsed.data.notes ?? null,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 400 },
    );
  }
}
