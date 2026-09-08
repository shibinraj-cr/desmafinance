import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { ChangePasswordClient } from "./client";
import { CelebrationOptOutClient } from "./celebration-optout";

export const dynamic = "force-dynamic";

export default async function MyAccountPage() {
  const { session, userId } = await getCurrentUserAndPermissions();
  if (!session?.user || !userId) redirect("/login");

  // Null for a login with no linked Employee record — they have no dates on
  // file, so there is nothing for them to opt out of and the card is omitted.
  const employee = await prisma.employee
    .findUnique({ where: { userId }, select: { celebrationOptOut: true } })
    .catch(() => null);

  return (
    <>
      <TopBar title="My Account" subtitle={session.user.name ?? session.user.email ?? undefined} />
      <div className="p-margin space-y-lg max-w-md">
        <ChangePasswordClient />
        {employee ? <CelebrationOptOutClient optedOut={employee.celebrationOptOut} /> : null}
      </div>
    </>
  );
}
