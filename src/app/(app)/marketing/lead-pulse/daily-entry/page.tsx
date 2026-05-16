import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { prisma } from "@/lib/prisma";
import { todayIst, fromPrismaDate, toPrismaDate } from "@/lib/lead-pulse-dates";
import { DailyEntryForm, AdminDailyEntryPreview } from "./client";

export const dynamic = "force-dynamic";

export default async function DailyEntryPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);

  // Only L1 / L2 BDEs submit daily entries. Admins / supervisors who
  // land here get a read-only preview of the L1 and L2 form variants
  // (tab-switchable) so they can see what each BDE role experiences
  // without needing to log in as one.
  if (access.role !== "l1" && access.role !== "l2") {
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
            <h1 className="text-[20px] font-semibold mb-[8px]">Daily Entry is for BDEs</h1>
            <p style={{ color: "var(--lp-on-surface-variant)" }}>
              You don&apos;t have a Lead Pulse role assigned. Contact your supervisor.
            </p>
          </div>
        </div>
      );
    }
    const previewSources = await prisma.leadPulseSource.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
    });
    return (
      <AdminDailyEntryPreview
        sources={previewSources.map((s) => ({
          id: s.id,
          code: s.code,
          label: s.label,
          displayOrder: s.displayOrder,
        }))}
        today={todayIst()}
      />
    );
  }
  if (!access.canSubmitEntries) {
    return (
      <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
        <div
          className="rounded-[12px] p-[24px] border"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
          }}
        >
          <h1 className="text-[20px] font-semibold mb-[8px]">Your roster row is inactive</h1>
          <p style={{ color: "var(--lp-on-surface-variant)" }}>
            Contact your supervisor to re-activate your Lead Pulse access before submitting
            entries.
          </p>
        </div>
      </div>
    );
  }

  const today = todayIst();
  // The 3-day backdate cap on editing is enforced by the `locked` flag on
  // historical entries (set by the importer + the nightly cron). The date
  // picker itself goes much further back so BDEs can browse their historical
  // entries in read-only mode.
  const historyEarliest = "2025-01-01";

  // Default landing date for L1/L2 BDEs is the *last working day* (most
  // recent non-Sunday, non-Holiday calendar day). Skipping today by
  // default reflects how the team actually uses the sheet — they log
  // yesterday's numbers when they sit down today.
  const lookbackStart = new Date(`${today}T00:00:00.000Z`);
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 30);
  const recentHolidays = await prisma.holiday.findMany({
    where: { date: { gte: lookbackStart } },
    select: { date: true },
  });
  const holidaySet = new Set(recentHolidays.map((h) => h.date.toISOString().slice(0, 10)));
  function lastWorkingDay(fromStr: string): string {
    const d = new Date(`${fromStr}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    for (let i = 0; i < 31; i++) {
      const ds = d.toISOString().slice(0, 10);
      if (d.getUTCDay() !== 0 && !holidaySet.has(ds)) return ds;
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return fromStr;
  }
  const defaultDate = lastWorkingDay(today);

  const requestedDate =
    searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
      ? searchParams.date
      : defaultDate;
  const date =
    requestedDate > today
      ? today
      : requestedDate < historyEarliest
        ? historyEarliest
        : requestedDate;

  // Server-render the initial payload so the form has correct values
  // before hydration. The client will refetch on date change.
  const [sources, entries, meta] = await Promise.all([
    prisma.leadPulseSource.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
    }),
    prisma.leadPulseDailyEntry.findMany({
      where: { userId, entryDate: toPrismaDate(date) },
    }),
    prisma.leadPulseDailyMeta.findUnique({
      where: { userId_entryDate: { userId, entryDate: toPrismaDate(date) } },
    }),
  ]);

  // Rejected entries get a hard re-edit pass: the lock and any
  // `entry.locked` flags are overridden so the BDE can fix the
  // supervisor's flagged issues. Approved entries are read-only.
  const anyLocked = entries.some((e) => e.locked) || (meta?.locked ?? false);
  const editable =
    meta?.status === "rejected"
      ? true
      : meta?.status === "approved"
        ? false
        : !anyLocked;
  const rejection =
    meta?.status === "rejected"
      ? {
          note: meta.reviewNote ?? "",
          reviewedAt: meta.reviewedAt?.toISOString() ?? null,
        }
      : null;

  return (
    <DailyEntryForm
      role={access.role}
      displayName={access.displayName ?? ""}
      date={date}
      today={today}
      earliest={historyEarliest}
      editable={editable}
      rejection={rejection}
      sources={sources.map((s) => ({
        id: s.id,
        code: s.code,
        label: s.label,
        displayOrder: s.displayOrder,
      }))}
      initialEntries={entries.map((e) => ({
        sourceId: e.sourceId,
        leadsReceived: e.leadsReceived ?? 0,
        connectedCalls: e.connectedCalls ?? 0,
        disqualified: e.disqualified ?? 0,
        transferredToL2: e.transferredToL2 ?? 0,
        receivedFromL1: e.receivedFromL1 ?? 0,
        directLeads: e.directLeads ?? 0,
        connected: e.connected ?? 0,
        quoteSent: e.quoteSent ?? 0,
        closedWon: e.closedWon ?? 0,
        closedLost: e.closedLost ?? 0,
        status: e.status,
        locked: e.locked,
        submittedAt: e.submittedAt?.toISOString() ?? null,
        entryDate: fromPrismaDate(e.entryDate),
      }))}
      initialMeta={
        meta
          ? {
              totalFollowups: meta.totalFollowups ?? 0,
              referredToDoc: meta.referredToDoc ?? 0,
              referredToAbroad: meta.referredToAbroad ?? 0,
              notes: meta.notes ?? "",
              status: meta.status,
              locked: meta.locked,
              submittedAt: meta.submittedAt?.toISOString() ?? null,
            }
          : {
              totalFollowups: 0,
              referredToDoc: 0,
              referredToAbroad: 0,
              notes: "",
              status: "draft",
              locked: false,
              submittedAt: null,
            }
      }
    />
  );
}
