import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess, leadPulseRoleLabel } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";

export default async function LeadPulseHomePage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getLeadPulseAccess(userId, perms);

  // Role-aware landing per BUILD_SPEC §4:
  //   L1 / L2 → /daily-entry
  //   Supervisor → dashboard (this page)
  //   Unassigned (non-admin) → friendly 403
  if (access.role === "l1" || access.role === "l2") {
    redirect("/marketing/lead-pulse/daily-entry");
  }
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
          <h1 className="text-[20px] font-semibold mb-[8px]">Lead Pulse access required</h1>
          <p style={{ color: "var(--lp-on-surface-variant)" }}>
            You don&apos;t have a Lead Pulse role assigned yet. Contact your supervisor to get
            added to the team roster.
          </p>
        </div>
      </div>
    );
  }

  // Supervisor / DESFIN admin landing. Phase A shows a brief overview + nav cards
  // to the team roster and settings; the full dashboard ships in Phase C.
  return (
    <div className="px-[24px] py-[24px] space-y-[24px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight">Lead Pulse Dashboard</h1>
          <p className="mt-[4px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            {access.desfinAdmin && access.role !== "supervisor"
              ? "Admin view — full Lead Pulse access."
              : `Welcome${access.displayName ? `, ${access.displayName}` : ""} · ${leadPulseRoleLabel(access.role)}.`}
          </p>
        </div>
      </header>

      <div
        className="rounded-[12px] p-[24px] border"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        <div className="flex items-start gap-[12px]">
          <span
            className="inline-flex items-center justify-center w-[40px] h-[40px] rounded-[8px]"
            style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
              construction
            </span>
          </span>
          <div className="flex-1">
            <h2 className="text-[16px] font-semibold mb-[4px]">Phase A: Foundations live</h2>
            <p style={{ color: "var(--lp-on-surface-variant)" }}>
              Lead Pulse is now wired up. Use Team Roster to assign L1 / L2 / Supervisor roles
              to your DESFIN users, and Settings to manage sources &amp; regions. Daily Entry,
              Monthly Funnel Report, and BDE Performance ship in subsequent phases.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-[16px]">
        <NavCard
          href="/marketing/lead-pulse/team-roster"
          title="Team Roster"
          subtitle="Assign Lead Pulse roles to DESFIN users"
          icon="groups"
        />
        <NavCard
          href="/marketing/lead-pulse/settings"
          title="Settings"
          subtitle="Sources, regions, lock overrides"
          icon="tune"
        />
        <NavCard
          href="/marketing/lead-pulse/daily-entry"
          title="Daily Entry (preview)"
          subtitle="Available once at least one BDE is rostered (Phase B)"
          icon="edit_note"
        />
      </div>
    </div>
  );
}

function NavCard({
  href,
  title,
  subtitle,
  icon,
}: {
  href: string;
  title: string;
  subtitle: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-[12px] p-[20px] border transition hover:translate-y-[-1px]"
      style={{
        backgroundColor: "var(--lp-surface-container)",
        borderColor: "var(--lp-outline-variant)",
      }}
    >
      <span
        className="inline-flex items-center justify-center w-[36px] h-[36px] rounded-[8px] mb-[12px]"
        style={{
          backgroundColor: "var(--lp-surface-container-high)",
          color: "var(--lp-primary)",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
          {icon}
        </span>
      </span>
      <h3 className="text-[16px] font-semibold">{title}</h3>
      <p
        className="text-[13px] mt-[4px]"
        style={{ color: "var(--lp-on-surface-variant)" }}
      >
        {subtitle}
      </p>
    </Link>
  );
}
