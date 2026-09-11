import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";
import {
  AchievementMeter,
  AchievementTrendChart,
  MonthlyCollectionChart,
  QuarterTargetChart,
} from "@/components/SalesObjectiveCharts";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { inr, inrFull } from "@/lib/format";
import {
  COMMIT_RATE,
  DEVIATION_TOLERANCE,
  LEDGER_FROM,
  getSalesObjective,
  monthLabelFromKey,
  type ObjectiveMonth,
  type ObjectiveQuarter,
} from "@/lib/sales-objective";

export const dynamic = "force-dynamic";

const PAGE = "/executive/sales-objective";

export default async function SalesObjectivePage({
  searchParams,
}: {
  searchParams: { fy?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!perms.isAdmin) {
    return (
      <>
        <TopBar title="Sales Objective" />
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

  const objective = await getSalesObjective();
  const { current, lastClosed } = objective;

  const scope = objective.fyList.includes(searchParams.fy ?? "") ? searchParams.fy! : "all";
  const quarters = objective.quarters.filter((q) => scope === "all" || q.fy === scope);
  const months = objective.months.filter((m) => scope === "all" || m.fy === scope);

  const firstLive = months.find((m) => m.source === "ledger");
  const perDay =
    objective.currentShortfall !== null && objective.daysLeftInQuarter > 0
      ? objective.currentShortfall / objective.daysLeftInQuarter
      : null;

  return (
    <>
      <TopBar
        title="Sales Objective"
        subtitle={`Collection against the ${COMMIT_RATE * 100}% target · ${objective.months[0].label} → ${objective.months[objective.months.length - 1].label}`}
        action={
          <Link
            href="/executive/dashboard"
            className="text-accent text-label-sm font-semibold hover:underline"
          >
            ← CEO Dashboard
          </Link>
        }
      />

      <div className="p-margin space-y-lg">
        {/* Filter row — scopes everything below it. */}
        <div className="flex flex-wrap items-center gap-md bg-surface-container-lowest border border-outline-variant rounded-xl px-lg py-md">
          <span className="text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold">
            Scope
          </span>
          <div className="flex items-center gap-xs bg-surface-container rounded-lg p-[3px]">
            <ScopeTab href={PAGE} label="All years" active={scope === "all"} />
            {objective.fyList.map((fy) => (
              <ScopeTab
                key={fy}
                href={`${PAGE}?fy=${encodeURIComponent(fy)}`}
                label={fy}
                active={scope === fy}
              />
            ))}
          </div>
          {/* Provenance only — each chart carries its own series legend. */}
          <div className="flex flex-wrap items-center gap-lg ml-auto text-caption text-on-surface-variant">
            <LegendKey swatch="#C9A019" label="Collected · DesGro ledger" />
            <LegendKey swatch="#E3D08A" label="Collected · frozen archive" />
          </div>
        </div>

        {objective.archiveEmpty && (
          <div className="flex items-start gap-md bg-surface-container border border-outline-variant rounded-xl px-lg py-md">
            <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 22 }}>
              inventory_2
            </span>
            <div className="text-body-md">
              <p className="font-semibold text-on-surface">
                Showing {monthLabelFromKey(LEDGER_FROM)} onward only — the pre-ledger archive
                hasn&apos;t been loaded on this database.
              </p>
              <p className="text-caption mt-xs text-on-surface-variant">
                Load it from the objective workbook with{" "}
                <Code>npx tsx prisma/seed-sales-objective-archive.ts &lt;workbook.xlsx&gt;</Code>. The
                figures are kept out of source on purpose — this repository is public.
              </p>
            </div>
          </div>
        )}

        {objective.reviewCount > 0 && (
          <div className="flex items-start gap-md bg-error-container text-on-error-container border border-error/30 rounded-xl px-lg py-md">
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
              warning
            </span>
            <div className="text-body-md">
              <p className="font-semibold">
                {objective.reviewCount} month{objective.reviewCount === 1 ? "" : "s"} differ from
                the objective sheet by more than {DEVIATION_TOLERANCE * 100}%
              </p>
              <p className="text-caption mt-xs">
                The ledger figure is the one being used. Check the “vs sheet” column below — a gap
                this size usually means the sheet netted something off the collected amount.
              </p>
            </div>
          </div>
        )}

        {/* Headline */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
          {current && (
            <KpiCard
              label={`${current.short} collected`}
              value={current.collected}
              tone="primary"
              hero
              hint={
                current.committed === null
                  ? "No target set — the previous quarter hasn't closed"
                  : `${((current.achievement ?? 0) * 100).toFixed(1)}% of the ${inr(current.committed)} committed target`
              }
            />
          )}
          {current && current.committed !== null && (
            <KpiCard
              label={`${current.short} still to collect`}
              value={Math.max(0, objective.currentShortfall ?? 0)}
              tone={(objective.currentShortfall ?? 0) > 0 ? "danger" : "success"}
              hero
              hint={
                (objective.currentShortfall ?? 0) <= 0
                  ? `Target cleared with ${inr(Math.abs(objective.currentShortfall ?? 0))} to spare`
                  : `${objective.daysLeftInQuarter} day${objective.daysLeftInQuarter === 1 ? "" : "s"} left · ${inr(perDay ?? 0)}/day to close at target`
              }
            />
          )}
          {lastClosed && (
            <KpiCard
              label={`Last closed quarter · ${lastClosed.short}`}
              value={`${((lastClosed.achievement ?? 0) * 100).toFixed(1)}%`}
              tone={(lastClosed.achievement ?? 0) >= 1 ? "success" : "default"}
              hero
              hint={`${inr(lastClosed.collected)} of ${inr(lastClosed.committed ?? 0)} committed · ${((lastClosed.vsStretch ?? 0) * 100).toFixed(1)}% of the 2× stretch`}
            />
          )}
          <KpiCard
            label="Rolling 12 months"
            value={objective.rolling12}
            trendPct={objective.rolling12GrowthPct}
            hint={`vs ${inr(objective.prior12)} in the twelve before it`}
          />
          <KpiCard
            label="This FY to date"
            value={objective.fyToDate}
            trendPct={objective.fyGrowthPct}
            hint={`vs ${inr(objective.fyPriorSamePeriod)} over the same months last year`}
          />
          {current && (
            <KpiCard
              label="Next quarter's stretch bar"
              value={objective.nextStretchProvisional ?? 0}
              hint={`Provisional — 2× ${current.short}'s collection so far. Fixes when the quarter closes; committed will be ${inr((objective.nextStretchProvisional ?? 0) * COMMIT_RATE)}.`}
            />
          )}
        </section>

        {/* Trend */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
          <div className="lg:col-span-2">
            <Section title="Quarter collection vs target">
              <p className="text-caption text-on-surface-variant -mt-md mb-md">
                Each quarter is targeted at twice the previous quarter&apos;s collection, committed at{" "}
                {COMMIT_RATE * 100}%. The dashed rule steps because the bar moves with every close.
              </p>
              <QuarterTargetChart
                data={quarters.map((q) => ({
                  short: q.short,
                  collected: q.collected,
                  committed: q.committed,
                  stretch: q.stretch,
                  live: q.live,
                }))}
              />
            </Section>
          </div>
          <div className="lg:col-span-1">
            <Section title="Achievement trend">
              <p className="text-caption text-on-surface-variant -mt-md mb-md">
                Collection as a share of that quarter&apos;s committed target.
              </p>
              <AchievementTrendChart
                data={quarters
                  .filter((q) => q.achievement !== null && q.collected > 0)
                  .map((q) => ({
                    short: q.short,
                    achievement: q.achievement === null ? null : q.achievement * 100,
                    complete: q.complete,
                  }))}
              />
            </Section>
          </div>
        </section>

        <Section title="Monthly collection">
          <p className="text-caption text-on-surface-variant -mt-md mb-md">
            The committed target split evenly across each quarter&apos;s three months. From{" "}
            {monthLabelFromKey(LEDGER_FROM)} the bars are DesGro&apos;s own ledger; everything before is
            the frozen archive carried from the objective sheet.
          </p>
          <MonthlyCollectionChart
            data={months.map((m) => ({
              label: m.label,
              collected: m.collected,
              target: m.target,
              live: m.source === "ledger",
            }))}
            ledgerFromLabel={firstLive?.label}
          />
        </Section>

        {/* The sheet */}
        <Section title="Objective sheet">
          <p className="text-caption text-on-surface-variant -mt-md mb-md">
            Every target here is recomputed from the chain rule, not copied — correct an actual and
            each quarter after it re-targets itself.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-body-md border-collapse">
              <thead>
                <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant border-b border-outline">
                  <Th align="left">Quarter</Th>
                  <Th align="left">Month</Th>
                  <Th>Collected</Th>
                  <Th align="left">Source</Th>
                  <Th>vs sheet</Th>
                  <Th>Monthly target</Th>
                  <Th>Achieved</Th>
                  <Th>Gap</Th>
                  <Th>Stretch 2×</Th>
                  <Th>Committed {COMMIT_RATE * 100}%</Th>
                </tr>
              </thead>
              <tbody>
                {quarters.map((q) => (
                  <QuarterRows key={q.id} quarter={q} />
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="How these numbers are produced">
          <div className="space-y-md text-body-md text-on-surface-variant">
            <Note icon="bolt">
              <b className="text-on-surface">{monthLabelFromKey(LEDGER_FROM)} onward is live.</b>{" "}
              Each month sums <Code>Transaction</Code> rows where <Code>type = &quot;Revenue&quot;</Code>{" "}
              and the row isn&apos;t soft-deleted, bucketed by transaction date — the same filter the
              CEO Dashboard&apos;s revenue tile uses, so the two screens can&apos;t disagree.
            </Note>
            <Note icon="inventory_2">
              <b className="text-on-surface">Everything before it is frozen.</b> DesGro holds no
              ledger for those months, so they are read from{" "}
              <Code>SalesObjectiveArchive</Code> — loaded from the objective workbook by{" "}
              <Code>prisma/seed-sales-objective-archive.ts</Code>. They never recompute and never
              move, and they sit in the database rather than in source because this repository is
              public.
            </Note>
            <Note icon="rule">
              <b className="text-on-surface">Where the two disagree, the ledger wins.</b> A gap under{" "}
              {DEVIATION_TOLERANCE * 100}% is adopted silently and shown in the “vs sheet” column;
              anything larger also raises the banner at the top of this page.
            </Note>
            <Note icon="edit_note">
              <b className="text-on-surface">Two workbook labels are corrected here.</b> The column
              called “% of Growth” is not growth — it is the quarter&apos;s collection divided by its
              stretch target, so it reads as <i>Achievement</i>. And “Per Day Collection” divided the
              quarter target by 100 rather than by the days in the quarter; the run-rate on this page
              uses real days.
            </Note>
            <Note icon="schedule">
              <b className="text-on-surface">The running quarter is never scored.</b> Its achievement
              is pace, not a verdict, and the next quarter&apos;s bar stays provisional because it
              doubles a quarter that hasn&apos;t finished. The first three quarters of the series
              predate the target policy and correctly carry no target.
            </Note>
          </div>
        </Section>
      </div>
    </>
  );
}

function QuarterRows({ quarter: q }: { quarter: ObjectiveQuarter }) {
  return (
    <>
      {q.months.map((m, i) => (
        <MonthRow key={m.key} month={m} quarterLabel={i === 0 ? q.short : ""} />
      ))}
      <tr className="bg-surface-container font-semibold border-b-2 border-outline">
        <Td align="left">{q.short}</Td>
        <Td align="left" muted>
          {q.complete ? "quarter close" : "quarter to date"}
        </Td>
        <Td mono>{inrFull(q.collected)}</Td>
        <Td align="left">
          <SourcePill source={q.live ? "ledger" : "archive"} />
        </Td>
        <Td muted>—</Td>
        <Td mono muted>
          {q.monthlyTarget === null ? "—" : inrFull(q.monthlyTarget)}
        </Td>
        <Td>
          <AchievementMeter value={q.achievement} />
        </Td>
        <Td mono>
          <GapCell value={q.surplus === null ? null : -q.surplus} />
        </Td>
        <Td mono muted>
          {q.stretch === null ? "—" : inrFull(q.stretch)}
        </Td>
        <Td mono>{q.committed === null ? "—" : inrFull(q.committed)}</Td>
      </tr>
    </>
  );
}

function MonthRow({ month: m, quarterLabel }: { month: ObjectiveMonth; quarterLabel: string }) {
  return (
    <tr className={"border-b border-outline-variant " + (m.needsReview ? "bg-error-container/40" : "")}>
      <Td align="left" muted>
        {quarterLabel}
      </Td>
      <Td align="left">
        {m.label}
        {m.running && (
          <span className="ml-xs text-caption text-on-surface-variant font-semibold">open</span>
        )}
      </Td>
      <Td mono>{m.collected === null ? "—" : inrFull(m.collected)}</Td>
      <Td align="left">
        <SourcePill source={m.source} fallback={m.archiveFallback} />
      </Td>
      <Td mono>
        {m.deviation === null ? (
          <span className="text-on-surface-variant">—</span>
        ) : Math.round(m.deviation) === 0 ? (
          <span className="text-on-surface-variant">matches</span>
        ) : (
          <span className={m.needsReview ? "text-error font-semibold" : "text-on-surface-variant"}>
            {m.deviation > 0 ? "+" : "−"}
            {inrFull(Math.abs(m.deviation)).slice(1)}
            {m.deviationPct !== null && (
              <span className="text-caption"> ({(m.deviationPct * 100).toFixed(1)}%)</span>
            )}
          </span>
        )}
      </Td>
      <Td mono muted>
        {m.target === null ? "—" : inrFull(m.target)}
      </Td>
      <Td>
        <AchievementMeter value={m.achievement} />
      </Td>
      <Td mono>
        <GapCell value={m.gap} />
      </Td>
      <Td muted>—</Td>
      <Td muted>—</Td>
    </tr>
  );
}

/** Positive = short of target (red), negative = over target (green). */
function GapCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-on-surface-variant">—</span>;
  if (Math.round(value) === 0) return <span className="text-on-surface-variant">on target</span>;
  const short = value > 0;
  return (
    <span className={short ? "text-error" : "text-green-700"}>
      {short ? "−" : "+"}
      {inrFull(Math.abs(value)).slice(1)}
    </span>
  );
}

function SourcePill({
  source,
  fallback,
}: {
  source: "ledger" | "archive" | "pending";
  fallback?: boolean;
}) {
  if (source === "ledger") {
    return (
      <span className="inline-flex items-center gap-xs px-xs py-[1px] rounded-full text-caption font-semibold bg-primary-fixed text-accent">
        ledger
      </span>
    );
  }
  if (source === "pending") {
    return (
      <span className="inline-flex items-center px-xs py-[1px] rounded-full text-caption font-semibold border border-dashed border-outline text-on-surface-variant">
        pending
      </span>
    );
  }
  return (
    <span
      title={fallback ? "No Revenue rows posted for this month — the sheet figure stands in" : undefined}
      className={
        "inline-flex items-center gap-xs px-xs py-[1px] rounded-full text-caption font-semibold " +
        (fallback
          ? "bg-error-container text-on-error-container"
          : "bg-surface-container-high text-on-surface-variant")
      }
    >
      {fallback && (
        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
          error
        </span>
      )}
      archive
    </span>
  );
}

function ScopeTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={
        "px-md py-xs rounded-md text-label-sm font-semibold transition-colors " +
        (active
          ? "bg-surface-container-lowest text-on-surface shadow-sm"
          : "text-on-surface-variant hover:text-on-surface")
      }
    >
      {label}
    </Link>
  );
}

function LegendKey({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-xs">
      <span className="w-3 h-3 rounded-sm" style={{ background: swatch }} />
      {label}
    </span>
  );
}

function Note({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-md">
      <span className="material-symbols-outlined text-on-surface-variant flex-shrink-0" style={{ fontSize: 20 }}>
        {icon}
      </span>
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-xs py-[1px] rounded bg-surface-container text-on-surface text-caption">
      {children}
    </code>
  );
}

function Th({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={"py-sm px-md font-semibold whitespace-nowrap " + (align === "left" ? "text-left" : "text-right")}>
      {children}
    </th>
  );
}

function Td({
  children,
  align = "right",
  mono,
  muted,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={
        "py-sm px-md whitespace-nowrap " +
        (align === "left" ? "text-left " : "text-right ") +
        (mono ? "font-mono tabular-nums " : "") +
        (muted ? "text-on-surface-variant" : "")
      }
    >
      {children}
    </td>
  );
}
