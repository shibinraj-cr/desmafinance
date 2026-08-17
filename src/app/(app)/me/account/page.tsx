import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { ChangePasswordClient } from "./client";

export const dynamic = "force-dynamic";

export default async function MyAccountPage() {
  const { session, userId } = await getCurrentUserAndPermissions();
  if (!session?.user || !userId) redirect("/login");

  return (
    <>
      <TopBar title="My Account" subtitle={session.user.name ?? session.user.email ?? undefined} />
      <div className="p-margin space-y-lg max-w-md">
        <ChangePasswordClient />
      </div>
    </>
  );
}
