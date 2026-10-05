import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { todayIst } from "@/lib/lead-pulse-dates";
import { listMeetings } from "@/lib/meeting-notes";
import { MeetingNotesClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * Executive Meeting Notes — leadership meetings, what was decided, and the
 * action items that came out of them. Admin-only like the rest of the module;
 * shared across admins rather than owner-scoped.
 */
export default async function MeetingNotesPage({
  searchParams,
}: {
  searchParams?: { m?: string };
}) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");

  if (!perms?.isAdmin) {
    return (
      <>
        <TopBar title="Meeting Notes" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              You need admin access to view this page.
            </div>
          </Section>
        </div>
      </>
    );
  }

  const meetings = await listMeetings();

  return (
    <MeetingNotesClient meetings={meetings} today={todayIst()} initialSelectedId={searchParams?.m ?? null} />
  );
}
