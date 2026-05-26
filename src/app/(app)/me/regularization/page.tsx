import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { REGULARIZATION_REASONS, REGULARIZATION_WINDOW_WORKING_DAYS } from "@/lib/hr-regularization";
import { RegularizationRequestClient } from "./client";

export const dynamic = "force-dynamic";

export default async function MyRegularizationPage() {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");
  const emp = await employeeForUser(userId);
  if (!emp) {
    return (
      <>
        <TopBar title="Attendance Regularization" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              Your login isn&apos;t linked to an employee record. Ask HR to link your account.
            </div>
          </Section>
        </div>
      </>
    );
  }
  const requests = await prisma.hrAttendanceRegularization.findMany({
    where: { employeeId: emp.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const reasonLabel = Object.fromEntries(REGULARIZATION_REASONS.map((r) => [r.code, r.label]));
  return (
    <>
      <TopBar
        title="Attendance Regularization"
        subtitle={`Request a correction within ${REGULARIZATION_WINDOW_WORKING_DAYS} working days of the discrepancy`}
      />
      <div className="p-margin space-y-lg">
        <RegularizationRequestClient
          reasons={REGULARIZATION_REASONS as unknown as { code: string; label: string }[]}
          requests={requests.map((r) => ({
            id: r.id,
            date: r.date.toISOString().slice(0, 10),
            reasonType: r.reasonType,
            reasonLabel: reasonLabel[r.reasonType] ?? r.reasonType,
            reason: r.reason,
            proposedIn: r.proposedIn,
            proposedOut: r.proposedOut,
            status: r.status,
            reviewNote: r.reviewNote,
            createdAt: r.createdAt.toISOString(),
          }))}
        />
      </div>
    </>
  );
}
