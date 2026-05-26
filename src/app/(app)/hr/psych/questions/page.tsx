import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { QuestionsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function QuestionsPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Questions" />
        <div className="p-margin">
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">No access.</p>
          </Section>
        </div>
      </>
    );
  }

  const test = await prisma.psychTest.findFirst({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    include: { questions: { orderBy: { order: "asc" } } },
  });

  return (
    <>
      <TopBar
        title="Psychometric Questions"
        subtitle={test ? test.name : "No active cycle"}
      />
      <div className="p-margin">
        {test ? (
          <QuestionsClient
            questions={test.questions.map((q) => ({
              id: q.id,
              order: q.order,
              dimension: q.dimension,
              textEn: q.textEn,
              textMl: q.textMl,
              reverseScored: q.reverseScored,
              active: q.active,
            }))}
            canEdit={canApproveHr(perms)}
          />
        ) : (
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">
              No active psychometric cycle. Seed one via{" "}
              <code className="font-mono">prisma/seed-psych.ts</code>.
            </p>
          </Section>
        )}
      </div>
    </>
  );
}
