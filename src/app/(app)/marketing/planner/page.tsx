import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { todayIst, toPrismaDate } from "@/lib/lead-pulse-dates";
import {
  CAMPAIGN_TYPE_LABELS,
  FY_MONTHS,
  MKT_PLANNER_HREF,
  PACE_HOT,
  SERIES_COMMITTED,
  SERIES_SPENT,
  addDaysStr,
  canDecideMarketingBudget,
  canUseMarketingPlanner,
  compactRupees,
  formatInr,
  formatLakh,
  loadFySnapshot,
  niceScale,
  parsePlannerFy,
  pctOf,
  plannedInRange,
  plannerFys,
  quarterOfMonth,
  quarterRange,
  UNMAPPED_CHANNEL_ID,
  type ChannelRowDto,
} from "@/lib/mkt-planner";
import { NewCampaignButton } from "./_campaign-form";
import { Card, Icon, Meter, PaceBadge, PlannerHeader, StatusPill, Swatch, cardStyle, faintText, mutedText } from "./_ui";

export const dynamic = "force-dynamic";

type Attention = { icon: string; color: string; lead: string; text: string; href: string; cta: string };

export default async function MarketingPlannerOverview({ searchParams }: { searchParams: { fy?: string } }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  if (!canUseMarketingPlanner(perms)) redirect("/");
  const admin = canDecideMarketingBudget(perms);

  const fy = parsePlannerFy(searchParams.fy);
  const today = todayIst();
  const snap = await loadFySnapshot(fy, today);
  const { progress, totals } = snap;

  const brandIds = snap.campaigns
    .filter((c) => c.type === "brand" && !["idea", "cancelled", "done"].includes(c.display))
    .map((c) => c.id);
  const [users, pendingRealloc, overdueDeliverables, deliverableRows] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, username: true }, orderBy: { username: "asc" } }),
    prisma.mktReallocation.count({ where: { fy, status: "pending" } }),
    prisma.mktDeliverable.count({
      where: { doneAt: null, dueDate: { lt: toPrismaDate(today) }, campaign: { status: { notIn: ["cancelled", "done"] } } },
    }),
    brandIds.length
      ? prisma.mktDeliverable.findMany({ where: { campaignId: { in: brandIds } }, select: { campaignId: true, doneAt: true } })
      : Promise.resolve([]),
  ]);

  const base = `?fy=${fy}`;
  const yearPct = progress.yearFraction * 100;

  // ── Pace through the last finished month, and the running quarter's plan ──
  const lastIdx = progress.ended ? 11 : progress.monthIdx - 1;
  const planThrough = snap.planMonthly.slice(0, lastIdx + 1).reduce((a, b) => a + b, 0);
  const spentThrough = snap.spentMonthly.slice(0, lastIdx + 1).reduce((a, b) => a + b, 0);
  const paceDiff = spentThrough - planThrough;
  let quarterNote: string | null = null;
  if (progress.started && !progress.ended) {
    const q = quarterRange(fy, quarterOfMonth(progress.monthIdx));
    const alloc = q.months.reduce((a, m) => a + snap.planMonthly[m], 0);
    const p = plannedInRange(snap.campaigns, q.start, q.end);
    const planned = p.committedLike + p.awaiting + p.draft;
    if (planned > alloc) {
      quarterNote = `Campaigns planned for ${q.label.split(" · ")[1]} need ${formatLakh(planned)} against a ${formatLakh(alloc)} allocation.`;
    }
  }

  // ── Needs attention ──
  const attention: Attention[] = [];
  const named = (r: ChannelRowDto) => r.id !== UNMAPPED_CHANNEL_ID;
  if (lastIdx >= 0 && !progress.ended) {
    for (const r of snap.channelRows.filter(named)) {
      const plan = r.monthly[lastIdx];
      const spent = r.spentMonthly[lastIdx];
      if (plan > 0 && spent > plan * PACE_HOT) {
        attention.push({
          icon: "trending_up",
          color: "var(--lp-orange)",
          lead: "Running hot",
          text: `${r.name} spent ${formatInr(spent)} in ${FY_MONTHS[lastIdx]} against a ${formatInr(plan)} plan (${Math.round((spent / plan) * 100)}%).`,
          href: `${MKT_PLANNER_HREF}/budget${base}`,
          cta: "Review allocation",
        });
      }
    }
  }
  for (const r of snap.channelRows.filter((r) => named(r) && r.pace === "over_budget")) {
    attention.push({
      icon: "error",
      color: "var(--lp-error)",
      lead: "Over budget",
      text: `${r.name} has ${formatLakh(r.spent + r.committed)} spent or promised against ${formatLakh(r.budget)} for the year.`,
      href: `${MKT_PLANNER_HREF}/budget${base}`,
      cta: admin ? "Adjust the budget" : "Request a reallocation",
    });
  }
  const review = snap.ledger.filter((r) => r.attr.mode === "review");
  if (review.length) {
    attention.push({
      icon: "sell",
      color: "var(--lp-on-surface)",
      lead: `${review.length} payment${review.length === 1 ? "" : "s"} need a campaign`,
      text: `${formatInr(review.reduce((a, r) => a + r.amount, 0))} of Marketing spend couldn't be matched automatically.`,
      href: `${MKT_PLANNER_HREF}/budget${base}&view=review`,
      cta: "Tag spend",
    });
  }
  const awaiting = snap.campaigns.filter((c) => c.status === "awaiting");
  if (awaiting.length) {
    attention.push({
      icon: "schedule",
      color: "var(--lp-cyan)",
      lead: `${awaiting.length} campaign${awaiting.length === 1 ? "" : "s"} awaiting approval`,
      text: `${awaiting.slice(0, 3).map((c) => c.name).join(", ")}${awaiting.length > 3 ? "…" : ""} — ${formatLakh(awaiting.reduce((a, c) => a + c.budget, 0))} together.`,
      href: awaiting.length === 1 ? `${MKT_PLANNER_HREF}/campaigns/${awaiting[0].id}` : `${MKT_PLANNER_HREF}/timeline${base}`,
      cta: admin ? "Review them" : "See them",
    });
  }
  if (pendingRealloc) {
    attention.push({
      icon: "swap_horiz",
      color: "var(--lp-cyan)",
      lead: `${pendingRealloc} budget move${pendingRealloc === 1 ? "" : "s"} pending`,
      text: admin ? "Reallocation requests are waiting for your decision." : "Waiting for an Admin to decide.",
      href: `${MKT_PLANNER_HREF}/budget${base}`,
      cta: "Open requests",
    });
  }
  if (overdueDeliverables) {
    attention.push({
      icon: "event_busy",
      color: "var(--lp-orange)",
      lead: `${overdueDeliverables} overdue deliverable${overdueDeliverables === 1 ? "" : "s"}`,
      text: "Checklist items on running campaigns are past their due date.",
      href: `${MKT_PLANNER_HREF}/timeline${base}`,
      cta: "Open planner",
    });
  }
  for (const r of snap.channelRows.filter((r) => named(r) && r.pace === "under" && r.planToDate >= 50000)) {
    attention.push({
      icon: "south",
      color: "var(--lp-on-surface-variant)",
      lead: "Under-used",
      text: `${r.name} has used ${formatLakh(r.spent)} of the ${formatLakh(r.planToDate)} planned so far.`,
      href: `${MKT_PLANNER_HREF}/budget${base}`,
      cta: "Move it elsewhere?",
    });
  }

  // ── Chart ──
  const peak = Math.max(
    ...snap.planMonthly,
    ...snap.spentMonthly.map((s, i) => s + snap.committedMonthly[i]),
  );
  const { top, step } = niceScale(peak);
  const CHART_H = 220;
  const px = (v: number) => Math.round((v / top) * CHART_H);
  const ticks = Array.from({ length: 6 }, (_, i) => top - i * step);
  const nowIdx = progress.started && !progress.ended ? progress.monthIdx : -1;

  // ── KPI: return on spend ──
  const { leads, enrolled, anyMapped } = snap.leadTotals;
  const monthsLeft = progress.ended ? 0 : 12 - progress.monthIdx - progress.monthFraction;

  const upcoming = snap.campaigns
    .filter((c) => c.startDate && c.startDate >= today && c.startDate <= addDaysStr(today, 45) && !["cancelled", "idea"].includes(c.status))
    .sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1))
    .slice(0, 6);

  const brand = snap.campaigns.filter((c) => brandIds.includes(c.id));
  const brandProgress = new Map<string, { done: number; total: number }>();
  for (const d of deliverableRows) {
    const p = brandProgress.get(d.campaignId) ?? { done: 0, total: 0 };
    p.total += 1;
    if (d.doneAt) p.done += 1;
    brandProgress.set(d.campaignId, p);
  }

  const totalRow = {
    budget: totals.budget,
    spent: totals.spent,
    committed: totals.committed,
    left: totals.available,
    leads: snap.channelRows.reduce((a, r) => a + (r.leads ?? 0), 0),
  };

  return (
    <main className="max-w-[1400px] mx-auto px-[16px] md:px-[28px] py-[24px] flex flex-col gap-[20px]">
      <PlannerHeader
        tab="overview"
        fy={fy}
        fys={plannerFys()}
        admin={admin}
        actions={<NewCampaignButton channels={snap.channels} users={users} />}
      />

      {totals.budget === 0 && (
        <div className="rounded-[12px] border p-[16px] flex flex-wrap items-center gap-[12px] justify-between" style={{ ...cardStyle, borderStyle: "dashed" }}>
          <p className="text-[14px]">
            <strong className="font-semibold">No budget set for this year yet.</strong>{" "}
            <span style={mutedText}>
              {admin
                ? "Allocate each channel's monthly budget to start tracking spend against plan."
                : "An Admin sets each channel's monthly budget. Spend from the ledger still shows below."}
            </span>
          </p>
          {admin && (
            <Link href={`${MKT_PLANNER_HREF}/budget${base}`} className="text-[13px] font-semibold" style={{ color: "var(--lp-primary)" }}>
              Set the budget →
            </Link>
          )}
        </div>
      )}

      {/* KPIs */}
      <section aria-label="Budget at a glance" className="grid gap-[12px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        <Kpi label="Annual budget" value={formatLakh(totals.budget)} sub={`${snap.channelRows.filter((r) => r.budget > 0).length} channels funded`} />
        <Kpi
          label={<><Swatch color={SERIES_SPENT} /> Spent (finance ledger)</>}
          value={formatLakh(totals.spent)}
          sub={`${Math.round(pctOf(totals.spent, totals.budget))}% of budget · ${Math.round(yearPct)}% of the year gone`}
        >
          <Meter spentPct={pctOf(totals.spent, totals.budget)} commPct={0} markerPct={yearPct} height={6} />
        </Kpi>
        <Kpi label={<><Swatch color={SERIES_COMMITTED} /> Committed, not yet paid</>} value={formatLakh(totals.committed)} sub="Quotes, bookings and POs" />
        <Kpi
          label="Available to plan"
          value={formatLakh(totals.available)}
          valueColor={totals.available < 0 ? "var(--lp-error)" : "var(--lp-primary)"}
          sub={monthsLeft > 0.05 && totals.available > 0 ? `≈ ${formatLakh(totals.available / monthsLeft)} a month to March` : totals.available < 0 ? "Spent and promised beyond the budget" : "—"}
        />
        {anyMapped && enrolled > 0 ? (
          <Kpi
            label="Cost per enrollment"
            value={formatInr(totals.spent / enrolled)}
            sub={`${enrolled} enrolled · ${leads ? `${formatInr(totals.spent / leads)} per lead` : "no leads mapped"}`}
          />
        ) : anyMapped && leads > 0 ? (
          <Kpi label="Cost per lead" value={formatInr(totals.spent / leads)} sub={`${leads.toLocaleString("en-IN")} leads · no enrollments yet`} />
        ) : (
          <Kpi
            label="Cost per enrollment"
            value="—"
            sub={admin ? <Link href={`${MKT_PLANNER_HREF}/channels${base}`} style={{ color: "var(--lp-primary)" }}>Map CRM lead sources to channels</Link> : "Lead sources aren't mapped to channels yet"}
          />
        )}
      </section>

      {/* Pace banner */}
      {lastIdx >= 0 && planThrough > 0 && (
        <section aria-label="Pace" className="rounded-[12px] border px-[18px] py-[14px] flex flex-wrap items-center gap-[12px_24px]" style={cardStyle}>
          <div className="flex items-start gap-[10px] flex-[1_1_420px] min-w-0">
            <Icon name="schedule" size={20} style={{ color: "var(--lp-cyan)", marginTop: 1 }} />
            <p className="text-[14px] leading-relaxed">
              <strong className="font-semibold">
                {paceDiff === 0
                  ? "Exactly on plan"
                  : `${paceDiff < 0 ? "Under" : "Over"} plan by ${formatLakh(Math.abs(paceDiff))}`}{" "}
                through {FY_MONTHS[lastIdx]}.
              </strong>{" "}
              <span style={mutedText}>
                Plan was {formatLakh(planThrough)}, the ledger shows {formatLakh(spentThrough)}.
                {quarterNote ? ` ${quarterNote}` : ""}
              </span>
            </p>
          </div>
          <Link
            href={`${MKT_PLANNER_HREF}/budget${base}`}
            className="min-h-[40px] inline-flex items-center px-[14px] rounded-[8px] border text-[13px] font-semibold"
            style={{ borderColor: "var(--lp-primary)", color: "var(--lp-primary)" }}
          >
            {quarterNote ? "Rebalance the quarter" : "Open budget"}
          </Link>
        </section>
      )}

      <div className="flex flex-wrap gap-[16px] items-stretch">
        {/* Monthly chart */}
        <Card
          className="flex-[999_1_560px]"
          title="Monthly spend vs plan"
          subtitle="The running month is month-to-date · committed spend sits on the month it falls due"
          actions={
            <div className="flex flex-wrap gap-[14px] text-[12px]" style={mutedText}>
              <span className="inline-flex items-center gap-[6px]"><Swatch color={SERIES_SPENT} />Spent</span>
              <span className="inline-flex items-center gap-[6px]"><Swatch color={SERIES_COMMITTED} />Committed</span>
              <span className="inline-flex items-center gap-[6px]"><span className="inline-block w-[14px] h-[2px]" style={{ backgroundColor: "var(--lp-on-surface)" }} />Plan</span>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <div className="flex gap-[8px] min-w-[560px]">
              <div className="flex flex-col justify-between text-[10px] font-mono text-right pr-[4px] -translate-y-[6px]" style={{ height: CHART_H, ...faintText }}>
                {ticks.map((t) => (
                  <span key={t}>{compactRupees(t)}</span>
                ))}
              </div>
              <div className="flex-1 flex flex-col gap-[8px]">
                <div
                  className="relative grid gap-[4px] border-b"
                  style={{
                    height: CHART_H,
                    gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
                    borderColor: "var(--lp-outline-variant)",
                    backgroundImage: "linear-gradient(var(--lp-surface-container-high) 1px, transparent 1px)",
                    backgroundSize: `100% ${CHART_H / 5}px`,
                  }}
                >
                  {FY_MONTHS.map((m, i) => {
                    const spent = snap.spentMonthly[i];
                    const comm = snap.committedMonthly[i];
                    const plan = snap.planMonthly[i];
                    const tip = `${m}: spent ${formatInr(spent)}${comm ? `, committed ${formatInr(comm)}` : ""} · plan ${formatInr(plan)}`;
                    return (
                      <div
                        key={m}
                        title={tip}
                        className="relative flex flex-col justify-end items-center gap-[2px] rounded-t-[4px]"
                        style={{ height: CHART_H, backgroundColor: i === nowIdx ? "rgba(250, 204, 21, 0.06)" : undefined }}
                      >
                        {comm > 0 && <div className="w-[22px] rounded-t-[4px]" style={{ height: px(comm), backgroundColor: SERIES_COMMITTED }} />}
                        {spent > 0 && (
                          <div
                            className="w-[22px]"
                            style={{ height: Math.max(2, px(spent)), backgroundColor: SERIES_SPENT, borderRadius: comm > 0 ? 0 : "4px 4px 0 0" }}
                          />
                        )}
                        {plan > 0 && (
                          <div aria-hidden="true" className="absolute left-[18%] right-[18%] h-[2px]" style={{ bottom: px(plan), backgroundColor: "var(--lp-on-surface)" }} />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="grid gap-[4px] text-[11px] text-center" style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))" }}>
                  {FY_MONTHS.map((m, i) => (
                    <span key={m} style={{ color: i === nowIdx ? "var(--lp-primary)" : "var(--lp-outline)", fontWeight: i === nowIdx ? 600 : 400 }}>
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {lastIdx >= 0 && (
            <div className="flex flex-wrap gap-[8px_24px] text-[12px] border-t pt-[12px]" style={{ ...mutedText, borderColor: "var(--lp-surface-container-high)" }}>
              <span>
                To {FY_MONTHS[lastIdx]}: <span className="font-mono" style={{ color: "var(--lp-on-surface)" }}>{formatLakh(spentThrough)}</span> spent of{" "}
                <span className="font-mono" style={{ color: "var(--lp-on-surface)" }}>{formatLakh(planThrough)}</span> planned
              </span>
              <Link href={`${MKT_PLANNER_HREF}/budget${base}`} className="ml-auto font-medium" style={{ color: "var(--lp-primary)" }}>
                View as table
              </Link>
            </div>
          )}
        </Card>

        {/* Attention */}
        <Card className="flex-[1_1_320px]" title="Needs attention">
          {attention.length === 0 ? (
            <p className="text-[13px]" style={mutedText}>
              Nothing needs attention right now.
            </p>
          ) : (
            <ul className="flex flex-col">
              {attention.slice(0, 7).map((a, i) => (
                <li key={i} className="flex gap-[12px] py-[11px] border-b last:border-b-0" style={{ borderColor: "var(--lp-surface-container-high)" }}>
                  <Icon name={a.icon} size={18} style={{ color: a.color, marginTop: 1 }} />
                  <div className="flex flex-col gap-[4px] text-[13px] leading-snug min-w-0">
                    <p>
                      <strong className="font-semibold" style={{ color: a.color === "var(--lp-on-surface)" ? undefined : a.color }}>
                        {a.lead}
                      </strong>{" "}
                      · {a.text}
                    </p>
                    <Link href={a.href} className="text-[12px] font-medium" style={{ color: "var(--lp-primary)" }}>
                      {a.cta}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Channel table */}
      <Card
        title="Budget by channel"
        subtitle="Spent comes from finance ledger rows under Marketing; leads are CRM leads from the channel's mapped sources, enrollments are closed-won deals."
        actions={
          <div className="flex flex-wrap gap-[14px] text-[12px]" style={mutedText}>
            <span className="inline-flex items-center gap-[6px]"><Swatch color={SERIES_SPENT} />Spent</span>
            <span className="inline-flex items-center gap-[6px]"><Swatch color={SERIES_COMMITTED} />Committed</span>
            <span className="inline-flex items-center gap-[6px]"><span className="inline-block w-[2px] h-[12px]" style={{ backgroundColor: "var(--lp-on-surface)" }} />Year gone ({Math.round(yearPct)}%)</span>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[1000px] text-[13px]">
            <thead>
              <tr>
                {["Channel", "FY budget", "Spent", "Committed", "Used", "Left", "Leads", "Cost / lead", "Cost / enrollment", "Pace"].map((h, i) => (
                  <th
                    key={h}
                    className="px-[12px] py-[9px] text-[11px] font-semibold uppercase tracking-wider border-b whitespace-nowrap"
                    style={{ ...faintText, borderColor: "var(--lp-outline-variant)", textAlign: [1, 2, 3, 5, 6, 7, 8].includes(i) ? "right" : "left", width: i === 4 ? 170 : undefined }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snap.channelRows.map((r) => (
                <tr key={r.id} className="border-b" style={{ borderColor: "var(--lp-surface-container-high)" }}>
                  <td className="px-[12px] py-[11px]">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[11px] mt-[2px]" style={faintText}>
                      {r.id === UNMAPPED_CHANNEL_ID
                        ? "Marketing sub-items no channel claims"
                        : r.ledgerSubItems.length
                          ? `Ledger · ${r.ledgerSubItems.join(", ")}`
                          : "No ledger sub-item mapped yet"}
                    </div>
                  </td>
                  <Num v={formatLakh(r.budget)} />
                  <Num v={formatLakh(r.spent)} />
                  <Num v={r.committed ? formatLakh(r.committed) : "—"} muted />
                  <td className="px-[12px] py-[11px]">
                    <Meter
                      spentPct={r.spentPct}
                      commPct={r.commPct}
                      markerPct={r.budget > 0 ? yearPct : undefined}
                      title={`${Math.round(r.spentPct)}% spent, ${Math.round(r.commPct)}% committed`}
                    />
                  </td>
                  <Num v={formatLakh(r.left)} color={r.left < 0 ? "var(--lp-error)" : undefined} />
                  <Num v={r.leads === null ? "—" : r.leads.toLocaleString("en-IN")} />
                  <Num v={r.leads ? formatInr(r.spent / r.leads) : "—"} />
                  <Num v={r.enrolled ? formatInr(r.spent / r.enrolled) : "—"} />
                  <td className="px-[12px] py-[11px]">{r.id === UNMAPPED_CHANNEL_ID ? <span className="text-[12px]" style={faintText}>Map on Channels</span> : <PaceBadge pace={r.pace} />}</td>
                </tr>
              ))}
              <tr>
                <td className="px-[12px] py-[11px] font-semibold">Total</td>
                <Num v={formatLakh(totalRow.budget)} strong />
                <Num v={formatLakh(totalRow.spent)} strong />
                <Num v={formatLakh(totalRow.committed)} strong />
                <td className="px-[12px] py-[11px]">
                  <Meter spentPct={pctOf(totals.spent, totals.budget)} commPct={pctOf(totals.committed, totals.budget)} markerPct={totals.budget > 0 ? yearPct : undefined} />
                </td>
                <Num v={formatLakh(totalRow.left)} strong color={totalRow.left < 0 ? "var(--lp-error)" : "var(--lp-primary)"} />
                <Num v={anyMapped ? totalRow.leads.toLocaleString("en-IN") : "—"} strong />
                <Num v={totalRow.leads ? formatInr(totals.spent / totalRow.leads) : "—"} strong />
                <Num v={enrolled ? formatInr(totals.spent / enrolled) : "—"} strong />
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex flex-wrap gap-[16px] items-stretch">
        <Card
          className="flex-[999_1_560px]"
          title="Starting in the next 45 days"
          actions={
            <Link href={`${MKT_PLANNER_HREF}/timeline${base}`} className="text-[13px] font-medium" style={{ color: "var(--lp-primary)" }}>
              Open planner
            </Link>
          }
        >
          {upcoming.length === 0 ? (
            <p className="text-[13px]" style={mutedText}>
              Nothing scheduled to start in the next 45 days.
            </p>
          ) : (
            <ul className="flex flex-col">
              {upcoming.map((c) => (
                <li key={c.id} className="border-b last:border-b-0" style={{ borderColor: "var(--lp-surface-container-high)" }}>
                  <Link href={`${MKT_PLANNER_HREF}/campaigns/${c.id}`} className="grid gap-[14px] items-center py-[11px]" style={{ gridTemplateColumns: "64px minmax(0,1fr) auto" }}>
                    <span className="font-mono text-[12px] uppercase" style={faintText}>
                      {new Date(`${c.startDate}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium truncate">{c.name}</span>
                      <span className="block text-[12px] mt-[2px]" style={faintText}>
                        {CAMPAIGN_TYPE_LABELS[c.type]}
                        {c.channelName ? ` · ${c.channelName}` : ""}
                        {c.ownerName ? ` · ${c.ownerName}` : ""}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-[4px]">
                      <span className="font-mono text-[13px]">{formatLakh(c.budget)}</span>
                      <StatusPill status={c.display} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex-[1_1_320px]" title="Brand workstreams" subtitle="Long-running brand work, tracked by deliverables rather than leads.">
          {brand.length === 0 ? (
            <p className="text-[13px]" style={mutedText}>
              No brand campaigns running. Add one with the Brand type.
            </p>
          ) : (
            <ul className="flex flex-col gap-[14px]">
              {brand.map((c) => {
                const p = brandProgress.get(c.id);
                return (
                  <li key={c.id}>
                    <Link href={`${MKT_PLANNER_HREF}/campaigns/${c.id}`} className="flex flex-col gap-[6px]">
                      <span className="flex justify-between gap-[10px] text-[13px]">
                        <span className="truncate">{c.name}</span>
                        <span className="font-mono shrink-0" style={mutedText}>
                          {p ? `${p.done} / ${p.total} done` : c.display === "live" ? "Live" : `Starts ${c.startDate ?? "—"}`}
                        </span>
                      </span>
                      <span className="block h-[6px] rounded-[3px]" style={{ backgroundColor: "var(--lp-surface-container-high)" }}>
                        {p && p.total > 0 && (
                          <span className="block h-[6px] rounded-[3px]" style={{ width: `${(p.done / p.total) * 100}%`, backgroundColor: "var(--lp-primary)" }} />
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}

function Kpi({
  label,
  value,
  sub,
  valueColor,
  children,
}: {
  label: React.ReactNode;
  value: string;
  sub: React.ReactNode;
  valueColor?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-[12px] border px-[18px] py-[16px] flex flex-col gap-[6px]" style={cardStyle}>
      <p className="text-[12px] inline-flex items-center gap-[6px]" style={faintText}>
        {label}
      </p>
      <p className="font-mono text-[26px] leading-none" style={{ color: valueColor }}>
        {value}
      </p>
      {children}
      <p className="text-[12px]" style={mutedText}>
        {sub}
      </p>
    </div>
  );
}

function Num({ v, muted, strong, color }: { v: string; muted?: boolean; strong?: boolean; color?: string }) {
  return (
    <td
      className="px-[12px] py-[11px] text-right font-mono whitespace-nowrap"
      style={{ color: color ?? (muted ? "var(--lp-on-surface-variant)" : undefined), fontWeight: strong ? 500 : undefined }}
    >
      {v}
    </td>
  );
}
