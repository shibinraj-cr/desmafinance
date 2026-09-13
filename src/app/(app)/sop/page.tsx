import { redirect } from "next/navigation";
import { canSeePage } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * /sop has no screen of its own — it lands you on the most useful one you can
 * open. Someone with the dashboard grant gets the register; everyone else gets
 * the library, which every signed-in user can see.
 */
export default async function SopIndexPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  redirect(canSeePage(perms, "/sop/dashboard") ? "/sop/dashboard" : "/sop/library");
}
