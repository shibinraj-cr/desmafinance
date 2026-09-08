import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { applicationListInclude, serializeApplicationRow } from "@/lib/hiring/candidates";
import { bucketFollowUps, countAll } from "@/lib/hiring/follow-ups";
import { isAiEnabled } from "@/lib/anthropic";
import { FollowUpsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HiringFollowUpsPage({
  searchParams,
}: {
  searchParams: { owned?: string };
}) {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");

  if (!can(access, "candidate:read")) {
    return (
      <>
        <TopBar title="Follow-ups" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Follow-ups are visible to the hiring team.
          </div>
        </div>
      </>
    );
  }

  const ownedOnly = searchParams.owned === "1";

  // Everything still in play; the bucketing decides what actually needs chasing.
  const rows = await prisma.hiringApplication.findMany({
    where: {
      deletedAt: null,
      status: "active",
      job: { deletedAt: null, status: { in: ["live", "paused"] } },
      ...(ownedOnly ? { candidate: { ownerId: userId, deletedAt: null } } : {}),
    },
    include: applicationListInclude,
    orderBy: { stageEnteredAt: "asc" },
    take: 1000,
  });

  const groups = bucketFollowUps(rows.map((r) => serializeApplicationRow(r)));

  return (
    <>
      <TopBar
        title="Follow-ups"
        subtitle="Who to chase today — overdue, due now, and the shortlist nobody has called"
      />
      <div className="p-margin">
        <FollowUpsClient
          groups={groups}
          total={countAll(groups)}
          ownedOnly={ownedOnly}
          canMove={can(access, "candidate:move")}
          canWrite={can(access, "candidate:write")}
          aiEnabled={isAiEnabled()}
          loadedAt={new Date().toISOString()}
        />
      </div>
    </>
  );
}
