import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { STARTER_RECIPES } from "@/lib/hiring/automations";
import { AutomationsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");

  if (!can(access, "automation:manage")) {
    return (
      <>
        <TopBar title="Automations" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Recipes act on real candidates, so they are kept to the Owner and HR Manager tiers.
          </div>
        </div>
      </>
    );
  }

  const [automations, runs] = await Promise.all([
    prisma.hiringAutomation.findMany({
      include: { owner: { select: { username: true } }, _count: { select: { runs: true } } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.hiringAutomationRun.findMany({
      include: { automation: { select: { name: true } } },
      orderBy: { ranAt: "desc" },
      take: 40,
    }),
  ]);

  return (
    <>
      <TopBar title="Automations" subtitle="Recipes that act on candidates without you" />
      <div className="p-margin">
        <AutomationsClient
          automations={automations.map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
            isActive: a.isActive,
            trigger: a.trigger as { type: string; params?: Record<string, unknown> },
            actions: a.actions as { type: string; params?: Record<string, unknown> }[],
            lastFiredAt: a.lastFiredAt?.toISOString() ?? null,
            fireCount: a.fireCount,
            errorStreak: a.errorStreak,
            pauseReason: a.pauseReason,
            ownerName: a.owner?.username ?? null,
            runCount: a._count.runs,
          }))}
          runs={runs.map((r) => ({
            id: r.id,
            automationName: r.automation.name,
            status: r.status,
            error: r.error,
            durationMs: r.durationMs,
            ranAt: r.ranAt.toISOString(),
          }))}
          starters={STARTER_RECIPES}
          loadedAt={new Date().toISOString()}
        />
      </div>
    </>
  );
}
