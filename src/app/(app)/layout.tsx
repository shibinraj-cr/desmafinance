import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { countNewLeadsAssignedTo } from "@/lib/crm-leads";
import { countUnreadCrmNotifications } from "@/lib/crm-notify";
import { myTasksWhere } from "@/lib/ops-action-items";
import { countUnreadNews, tickerHeadlines } from "@/lib/news/read";
import {
  BAND_CELEBRATION_LIMIT,
  celebrationSettings,
  celebrationsToday,
  pendingGreeting,
  renderGreeting,
} from "@/lib/celebrations";
import { AnnouncementBand } from "@/components/AnnouncementBand";
import { CelebrationGreeting } from "@/components/CelebrationGreeting";
import { SideNav } from "@/components/SideNav";
import { GroupTabs } from "@/components/GroupTabs";
import { RouteProgress } from "@/components/RouteProgress";
import { AppLauncher } from "@/components/AppLauncher";
import { UsageTracker } from "@/components/UsageTracker";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, perms, userId } = await getCurrentUserAndPermissions();
  if (!session?.user || !perms || !userId) redirect("/login");

  // Pending-approvals badge count for managers/admins.
  // Rejected-queue count for the signed-in user (their own rejections
  // they haven't resubmitted or dismissed yet).
  // New-leads count: fresh leads assigned to the signed-in BDE, for the CRM
  // nav badge (0 for anyone with no fresh assigned leads).
  // Open-tasks badge: the signed-in user's still-open ad-hoc operations tasks,
  // for the "My Tasks" nav item (0 for anyone with none). Same `myTasksWhere`
  // the page itself uses, so the badge and the folder always agree.
  // Unread CRM notifications for the signed-in user, for the CRM
  // "Notifications" nav badge (0 for anyone with none).
  // Unread News & Updates: company-wide, so this one is badged in the header
  // rather than the nav list — it has to be visible from every module.
  // Today's birthdays and work anniversaries, for the band. Derived from
  // Employee.dob / .joinDate on every render rather than scheduled, so there is
  // no daily job to babysit and a corrected date of birth is right immediately.
  const [
    pendingCount,
    rejectedCount,
    newLeadsCount,
    myOpenTasksCount,
    crmNotifCount,
    newsUnreadCount,
    tickerItems,
    celebrations,
  ] = await Promise.all([
    prisma.pendingApproval.count({ where: { status: "pending" } }).catch(() => 0),
    prisma.pendingApproval
      .count({ where: { status: "rejected", submittedById: userId } })
      .catch(() => 0),
    countNewLeadsAssignedTo(userId),
    prisma.opsActionItem.count({ where: { ...myTasksWhere(userId), status: "open" } }).catch(() => 0),
    countUnreadCrmNotifications(userId),
    countUnreadNews(userId),
    // Headlines for the band under the header. Runs alongside the counts rather
    // than in its own round trip, since the shell already waits here.
    tickerHeadlines(userId),
    // Settings then today's celebrants — two dependent queries, but chained
    // inside the Promise.all so they overlap the counts above instead of
    // adding a round trip to every page render in the app.
    celebrationSettings().then(async (settings) => ({
      settings,
      today:
        settings.bandEnabled || settings.greetingEnabled
          ? await celebrationsToday({ settings })
          : [],
    })),
  ]);

  // Only costs a further query when the viewer is actually one of today's
  // celebrants — on an ordinary day `today` is empty and this is free.
  const greeting = celebrations.settings.greetingEnabled
    ? await pendingGreeting(userId, celebrations.today)
    : null;

  const bandCelebrations = celebrations.settings.bandEnabled
    ? celebrations.today.slice(0, BAND_CELEBRATION_LIMIT).map((c) => ({
        id: `${c.employeeId}:${c.kind}`,
        kind: c.kind,
        name: c.name,
        department: c.department,
        age: c.age,
        years: c.years,
        isSelf: c.userId === userId,
      }))
    : [];

  return (
    // flex-col on mobile so the mobile top bar stacks above main; flex-row
    // on md+ so the desktop sidebar sits to the left of main.
    <div className="flex flex-col md:flex-row min-h-screen bg-surface">
      <RouteProgress />
      <UsageTracker />
      <AppLauncher
        perms={perms}
        userName={session.user.name}
        newsUnreadCount={newsUnreadCount}
      />
      <SideNav
        user={{ name: session.user.name, email: session.user.email }}
        perms={perms}
        pendingCount={pendingCount}
        rejectedCount={rejectedCount}
        newLeadsCount={newLeadsCount}
        myOpenTasksCount={myOpenTasksCount}
        crmNotifCount={crmNotifCount}
        newsUnreadCount={newsUnreadCount}
      />
      <main className="flex-1 min-w-0 flex flex-col">
        <GroupTabs
          perms={perms}
          pendingCount={pendingCount}
          rejectedCount={rejectedCount}
          newLeadsCount={newLeadsCount}
          myOpenTasksCount={myOpenTasksCount}
          crmNotifCount={crmNotifCount}
          newsUnreadCount={newsUnreadCount}
        />
        {/* Below the header, on every page: today's birthdays and work
            anniversaries first, then unread updates. It renders nothing when
            there is neither, so it costs no space on an ordinary day. */}
        <AnnouncementBand celebrations={bandCelebrations} news={tickerItems} />
        {children}
      </main>
      {/* Fires once a year, on the celebrant's first page load of the day.
          Rendered outside <main> so the confetti is not clipped by a scrolling
          page, and absent entirely for everyone else. */}
      {greeting ? (
        <CelebrationGreeting
          greeting={{
            kind: greeting.kind,
            firstName: greeting.firstName,
            fullName: greeting.name,
            message: renderGreeting(greeting, celebrations.settings),
            years: greeting.years,
          }}
        />
      ) : null}
    </div>
  );
}
