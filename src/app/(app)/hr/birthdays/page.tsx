import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { monthLabel } from "@/lib/hr-birthdays";
import { istToday } from "@/lib/dates";
import {
  CELEBRATION_DEFAULTS,
  celebrationsInMonth,
  loadCelebrants,
  upcomingCelebrations,
} from "@/lib/celebrations";
import { BirthdayCalendarClient } from "./client";

export const dynamic = "force-dynamic";

export default async function BirthdayCalendarPage({
  searchParams,
}: {
  searchParams?: { month?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Birthday Calendar" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }
  const now = new Date();
  const ist = istToday(now);
  const monthNum = searchParams?.month && /^\d{1,2}$/.test(searchParams.month)
    ? Math.min(12, Math.max(1, Number(searchParams.month)))
    : ist.month;
  const [celebrants, settings] = await Promise.all([
    loadCelebrants(),
    prisma.hrBirthdaySettings.findFirst({ where: { singleton: true } }),
  ]);
  // Birthdays and work anniversaries together, the same as the employee-facing
  // page. Ages are shown here whatever the "show age" switch says: that switch
  // governs the company-wide band, and HR holds these dates already.
  const monthly = celebrationsInMonth(celebrants, monthNum, ist.year, now);
  const upcoming = upcomingCelebrations(celebrants, 30, now);
  const todayList = upcoming.filter((u) => u.delta === 0);
  return (
    <>
      <TopBar
        title="Birthday Calendar"
        subtitle={`${celebrants.length} active employees on the calendar · ${todayList.length} celebrating today`}
      />
      <div className="p-margin space-y-lg">
        <BirthdayCalendarClient
          canManage={canApproveHr(perms)}
          monthNum={monthNum}
          monthLabel={monthLabel(monthNum)}
          monthly={monthly}
          upcoming={upcoming}
          todayList={todayList}
          settings={
            settings
              ? {
                  autoWishEnabled: settings.autoWishEnabled,
                  reminderDays: settings.reminderDays,
                  channel: settings.channel,
                  template: settings.template,
                  bandEnabled: settings.bandEnabled,
                  greetingEnabled: settings.greetingEnabled,
                  anniversaryEnabled: settings.anniversaryEnabled,
                  showAge: settings.showAge,
                  anniversaryTemplate: settings.anniversaryTemplate,
                }
              : {
                  autoWishEnabled: false,
                  reminderDays: 1,
                  channel: "email",
                  ...CELEBRATION_DEFAULTS,
                }
          }
        />
      </div>
    </>
  );
}
