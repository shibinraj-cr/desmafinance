import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import {
  SettingsTabs,
  HistoricalImportButton,
  ReconcileHistoricalButton,
  Fix2027TypoButton,
} from "./client";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return (
      <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
        <div
          className="rounded-[12px] p-[24px] border"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
          }}
        >
          <p style={{ color: "var(--lp-on-surface-variant)" }}>
            Only Lead Pulse Supervisors and DESFIN Admins can access settings.
          </p>
        </div>
      </div>
    );
  }

  const [sources, regions, lockedEntries, auditEvents] = await Promise.all([
    prisma.leadPulseSource.findMany({
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
    }),
    prisma.leadPulseRegion.findMany({ orderBy: [{ label: "asc" }] }),
    prisma.leadPulseDailyEntry.findMany({
      where: { locked: true, status: "submitted" },
      orderBy: [{ entryDate: "desc" }],
      take: 100,
      include: {
        user: { select: { id: true, username: true } },
        source: { select: { id: true, label: true } },
      },
    }),
    prisma.leadPulseAuditLog.findMany({
      orderBy: [{ occurredAt: "desc" }],
      take: 100,
      include: { actor: { select: { username: true } } },
    }),
  ]);

  const initialTab =
    searchParams.tab === "regions" ||
    searchParams.tab === "lock-override" ||
    searchParams.tab === "audit"
      ? searchParams.tab
      : "sources";

  return (
    <div className="px-[24px] py-[24px] space-y-[24px]">
      <header>
        <h1 className="text-[30px] font-bold tracking-tight">Settings</h1>
        <p
          className="mt-[4px] text-[13px]"
          style={{ color: "var(--lp-on-surface-variant)" }}
        >
          Manage Lead Pulse sources, regions, and lock overrides.
        </p>
      </header>

      <HistoricalImportButton />

      <ReconcileHistoricalButton />

      <Fix2027TypoButton />

      <SettingsTabs
        initialTab={initialTab}
        sources={sources.map((s) => ({
          id: s.id,
          code: s.code,
          label: s.label,
          displayOrder: s.displayOrder,
          active: s.active,
        }))}
        regions={regions.map((r) => ({
          id: r.id,
          code: r.code,
          label: r.label,
          active: r.active,
        }))}
        lockedEntries={lockedEntries.map((e) => ({
          id: e.id,
          userId: e.user.id,
          username: e.user.username,
          sourceLabel: e.source.label,
          entryDate: e.entryDate.toISOString().slice(0, 10),
          submittedAt: e.submittedAt?.toISOString() ?? null,
          roleAtEntry: e.roleAtEntry,
        }))}
        auditEvents={auditEvents.map((a) => ({
          id: a.id,
          eventType: a.eventType,
          occurredAt: a.occurredAt.toISOString(),
          actorUsername: a.actor?.username ?? null,
          metadata: (a.metadata as Record<string, unknown> | null) ?? null,
        }))}
      />
    </div>
  );
}
