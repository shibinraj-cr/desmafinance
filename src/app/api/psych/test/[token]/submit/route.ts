import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findAssignmentByRawToken, hashIp } from "@/lib/psych-tokens";
import { scoreAssignment, computeSuspiciousFlags, type Dim } from "@/lib/psych-scoring";

const Body = z.object({
  responses: z
    .array(
      z.object({
        questionId: z.string().min(1),
        value: z.number().int().min(1).max(5),
      }),
    )
    .min(1),
});

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const assignment = await findAssignmentByRawToken(params.token);
  if (!assignment) return NextResponse.json({ error: "invalid_token" }, { status: 404 });
  if (assignment.status === "COMPLETED")
    return NextResponse.json({ error: "already_submitted" }, { status: 410 });
  if (assignment.status === "INVALIDATED")
    return NextResponse.json({ error: "invalidated" }, { status: 410 });
  if (assignment.expiresAt < new Date())
    return NextResponse.json({ error: "expired" }, { status: 410 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });

  const allowedIds = new Set(assignment.test.questions.map((q) => q.id));
  const incoming = parsed.data.responses.filter((r) => allowedIds.has(r.questionId));

  // Persist any responses that arrived only in the final submit payload.
  await prisma.$transaction(
    incoming.map((r) =>
      prisma.psychResponse.upsert({
        where: { assignmentId_questionId: { assignmentId: assignment.id, questionId: r.questionId } },
        create: { assignmentId: assignment.id, questionId: r.questionId, value: r.value },
        update: { value: r.value, savedAt: new Date() },
      }),
    ),
  );

  // Re-read the full set from DB so we score what actually got saved.
  const all = await prisma.psychResponse.findMany({
    where: { assignmentId: assignment.id },
    select: { questionId: true, value: true },
  });

  // Require an answer for every non-VALIDITY question. VALIDITY items are
  // expected but missing answers there shouldn't block submission since
  // they only affect the validity check.
  const required = assignment.test.questions.filter((q) => q.dimension !== "VALIDITY");
  const answeredIds = new Set(all.map((r) => r.questionId));
  const missing = required.filter((q) => !answeredIds.has(q.id));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "incomplete", missing: missing.length },
      { status: 400 },
    );
  }

  const startedAt = assignment.startedAt ?? assignment.assignedAt;
  const now = new Date();
  const durationSeconds = Math.round((now.getTime() - startedAt.getTime()) / 1000);

  const score = scoreAssignment({
    responses: all,
    questions: assignment.test.questions.map((q) => ({
      id: q.id,
      dimension: q.dimension,
      reverseScored: q.reverseScored,
      validityPairId: q.validityPairId ?? null,
    })),
    durationSeconds,
  });

  const suspiciousFlags = computeSuspiciousFlags(durationSeconds);

  const h = headers();
  const ipRaw = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "";

  await prisma.$transaction([
    prisma.psychReport.create({
      data: {
        assignmentId: assignment.id,
        employeeId: assignment.employeeId,
        oceanRaw: score.oceanRaw as unknown as Record<Dim, number>,
        oceanNormalized: score.oceanNormalized as unknown as Record<Dim, number>,
        oceanPercentile: score.oceanPercentile as unknown as Record<Dim, number>,
        attitudeIndex: score.attitudeIndex,
        attitudeClass: score.attitudeClass,
        profileType: score.profileType,
        profileLabel: score.profileLabel,
        riskFlags: score.riskFlags,
        recommendations: score.recommendations,
        validityPassed: score.validityPassed,
        validityNotes: score.validityNotes,
        durationSeconds,
        suspiciousFlags: suspiciousFlags,
      },
    }),
    prisma.psychAssignment.update({
      where: { id: assignment.id },
      data: {
        status: "COMPLETED",
        submittedAt: now,
        ipHash: ipRaw ? hashIp(ipRaw) : assignment.ipHash,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
