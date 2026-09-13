import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { getWealthOwner } from "@/lib/wealth-access";
import { bridgeSteps, getWealthSnapshot, outflowByMonth, syncReminders } from "@/lib/wealth";
import { WealthClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * The Personal Wealth desk.
 *
 * Admin-gated like the rest of the Executive module, but the data is
 * owner-gated: every query in lib/wealth filters on the signed-in user's id, so
 * a second admin opening this page gets their own empty desk rather than a view
 * of someone else's finances.
 */
export default async function WealthPage() {
  const { userId, allowed } = await getWealthOwner();
  if (!userId) redirect("/login");

  if (!allowed) {
    return (
      <>
        <TopBar title="Personal Wealth" />
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

  // Top up the dated instalments before reading. Idempotent — the
  // (holdingId, dueOn, kind) unique key means this creates nothing on a desk
  // that is already current, so the rail is right even if the cron missed a run.
  await syncReminders(userId).catch(() => undefined);

  const snapshot = await getWealthSnapshot(userId);
  const outflow = outflowByMonth(snapshot.reminders, snapshot.today);
  const bridge = bridgeSteps(snapshot.totals, snapshot.liabilities);

  return (
    <>
      <TopBar
        title="Personal Wealth"
        subtitle="Investments · Gold · Liabilities · Renewals"
        action={
          <div className="flex items-center gap-base">
            <span className="hidden md:inline-flex items-center gap-xs text-caption text-on-surface-variant">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                lock
              </span>
              Private to you
            </span>
            <Link
              href="/executive/dashboard"
              className="text-accent text-label-sm font-semibold hover:underline"
            >
              ← CEO Dashboard
            </Link>
          </div>
        }
      />
      <WealthClient snapshot={snapshot} outflow={outflow} bridge={bridge} />
    </>
  );
}
