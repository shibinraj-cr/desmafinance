/**
 * Finance-module mirror of /master-data/parties/[id]. Same UI, same API. The
 * shared master-data page only enforces "logged in"; we add the finance
 * page-access gate here so a user without /finance/parties can't reach the
 * candidate/vendor detail through the finance URL.
 */
import { redirect } from "next/navigation";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import MasterDataPartyDetailPage from "@/app/(app)/master-data/parties/[id]/page";

export const dynamic = "force-dynamic";

const PAGE = "/finance/parties";

export default async function FinancePartyDetailPage(props: { params: { id: string } }) {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, PAGE)) redirect("/finance/overview");
  return MasterDataPartyDetailPage(props);
}
