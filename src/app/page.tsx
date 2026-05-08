import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

export default async function RootPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  // Land on the user's first allowed page. Fallback to /finance/overview
  // for the canonical case.
  const target = perms.pages[0] ?? "/finance/overview";
  redirect(target);
}
