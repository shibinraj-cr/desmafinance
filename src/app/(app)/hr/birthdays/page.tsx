import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import {
  birthdaysForMonth,
  loadActiveEmployeeBirthdays,
  monthLabel,
  upcomingBirthdays,
} from "@/lib/hr-birthdays";
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
  const monthNum = searchParams?.month && /^\d{1,2}$/.test(searchParams.month)
    ? Math.min(12, Math.max(1, Number(searchParams.month)))
    : now.getUTCMonth() + 1;
  const [all, settings] = await Promise.all([
    loadActiveEmployeeBirthdays(),
    prisma.hrBirthdaySettings.findFirst({ where: { singleton: true } }),
  ]);
  const monthly = birthdaysForMonth(all, monthNum);
  const upcoming = upcomingBirthdays(all, 30);
  const todayList = upcoming.filter((u) => (u as { delta: number }).delta === 0);
  return (
    <>
      <TopBar
        title="Birthday Calendar"
        subtitle={`${all.length} active employees with a DOB on file · ${todayList.length} celebrating today`}
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
                }
              : {
                  autoWishEnabled: false,
                  reminderDays: 1,
                  channel: "email",
                  template:
                    "Happy birthday, {{name}}! Wishing you a wonderful year ahead. — Team DESGRO",
                }
          }
        />
      </div>
    </>
  );
}
