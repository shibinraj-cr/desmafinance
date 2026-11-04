import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { todayIst } from "@/lib/lead-pulse-dates";
import { listMeetingsSharedWith, listShareableUsers } from "@/lib/meeting-notes";
import { MyMeetingsClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * My Workspace → Meetings: the Executive meetings shared with this user, or
 * holding an action item they own. Read-only, except that an owner can update
 * their own action items and a meeting shared "can edit" can be edited (never
 * deleted or re-shared). Keyed on the login, not an employee record, so it
 * works for any user an admin can pick.
 */
export default async function MyMeetingsPage({ searchParams }: { searchParams?: { m?: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");

  const meetings = await listMeetingsSharedWith(userId);
  // The action-owner picker for editors lists every active login, as it does
  // for admins. Only fetched when the viewer can edit something.
  const users = meetings.some((m) => m.canEdit) ? await listShareableUsers() : [];
  return (
    <MyMeetingsClient
      meetings={meetings}
      today={todayIst()}
      userId={userId}
      users={users}
      initialSelectedId={searchParams?.m ?? null}
    />
  );
}
