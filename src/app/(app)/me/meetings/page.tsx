import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { todayIst } from "@/lib/lead-pulse-dates";
import { listMeetingsSharedWith } from "@/lib/meeting-notes";
import { MyMeetingsClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * My Workspace → Meetings: the Executive meetings shared with this user, or
 * holding an action item they own. Read-only, except that an owner can update
 * their own action items. Keyed on the login, not an employee record, so it
 * works for any user an admin can pick.
 */
export default async function MyMeetingsPage({ searchParams }: { searchParams?: { m?: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");

  const meetings = await listMeetingsSharedWith(userId);
  return (
    <MyMeetingsClient
      meetings={meetings}
      today={todayIst()}
      userId={userId}
      initialSelectedId={searchParams?.m ?? null}
    />
  );
}
