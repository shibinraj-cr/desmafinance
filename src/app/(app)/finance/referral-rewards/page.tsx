import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopBar } from "@/components/TopBar";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { PAYMENT_MODES } from "@/lib/catalog";
import { todayIst } from "@/lib/lead-pulse-dates";
import { REFERRAL_REWARD_AMOUNT, REFERRAL_REWARD_LEDGER, REFERRAL_REWARDS_PAGE } from "@/lib/crm-referral-link";
import { listReferralRewards } from "@/lib/crm-referral-reward";
import { ReferralRewardsClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * Referral Rewards — the flat reward owed to a candidate whenever someone they
 * referred enrols. Finance pays the candidate, then marks the reward paid here,
 * which drafts the expense to My Drafts for the usual review and approval.
 */
export default async function ReferralRewardsPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  if (!canSeePage(perms, REFERRAL_REWARDS_PAGE)) redirect("/finance/overview");

  const [rows, reviewer] = await Promise.all([
    listReferralRewards(),
    prisma.user.findFirst({ where: { draftFirst: true, isActive: true }, select: { username: true } }),
  ]);

  return (
    <>
      <TopBar title="Referral Rewards" subtitle="Finance" />
      <div className="p-margin">
        <ReferralRewardsClient
          rows={rows}
          today={todayIst()}
          paymentModes={[...PAYMENT_MODES]}
          reviewer={reviewer?.username ?? null}
          amount={REFERRAL_REWARD_AMOUNT}
          ledger={`${REFERRAL_REWARD_LEDGER.type} › ${REFERRAL_REWARD_LEDGER.category} › ${REFERRAL_REWARD_LEDGER.subItem}`}
        />
      </div>
    </>
  );
}
