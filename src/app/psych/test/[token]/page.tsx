import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { findAssignmentByRawToken, hashIp, MAX_START_ATTEMPTS } from "@/lib/psych-tokens";
import { dict, detectLocale } from "@/lib/psych-i18n";
import { TestClient } from "./client";
import { ErrorScreen } from "./error-screen";

export const dynamic = "force-dynamic";

export default async function PsychTestPage({ params }: { params: { token: string } }) {
  const h = headers();
  const accept = h.get("accept-language") ?? "";
  const locale = detectLocale(accept);

  const assignment = await findAssignmentByRawToken(params.token);
  if (!assignment) {
    return <ErrorScreen titleNode={dict.errors.expired_title} bodyNode={dict.errors.expired_body} initialLocale={locale} notFound />;
  }

  if (assignment.status === "COMPLETED") {
    return <ErrorScreen titleNode={dict.errors.completed_title} bodyNode={dict.errors.completed_body} initialLocale={locale} />;
  }

  if (assignment.status === "INVALIDATED") {
    return <ErrorScreen titleNode={dict.errors.invalidated_title} bodyNode={dict.errors.invalidated_body} initialLocale={locale} />;
  }

  const now = new Date();
  if (assignment.expiresAt < now || assignment.status === "EXPIRED") {
    return <ErrorScreen titleNode={dict.errors.expired_title} bodyNode={dict.errors.expired_body} initialLocale={locale} />;
  }

  // Rate limit: 3 start attempts per token. We use startAttempts as a
  // running counter — exceeded before any save → 429 page. Once the user
  // is IN_PROGRESS we stop counting (they're actively taking the test).
  if (assignment.startAttempts >= MAX_START_ATTEMPTS && assignment.status === "ASSIGNED") {
    return <ErrorScreen titleNode={dict.errors.rate_limit_title} bodyNode={dict.errors.rate_limit_body} initialLocale={locale} />;
  }

  // Bump start-attempts counter + capture ipHash on first hit (best-effort).
  const ipRaw = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "";
  await prisma.psychAssignment.update({
    where: { id: assignment.id },
    data: {
      startAttempts: { increment: 1 },
      ipHash: assignment.ipHash ?? (ipRaw ? hashIp(ipRaw) : undefined),
    },
  });

  const priorByQ: Record<string, number> = {};
  for (const r of assignment.responses) {
    priorByQ[r.questionId] = r.value;
  }

  return (
    <TestClient
      rawToken={params.token}
      employeeName={assignment.employee.name}
      initialLocale={locale}
      questions={assignment.test.questions.map((q) => ({
        id: q.id,
        textEn: q.textEn,
        textMl: q.textMl,
      }))}
      priorResponses={priorByQ}
    />
  );
}
