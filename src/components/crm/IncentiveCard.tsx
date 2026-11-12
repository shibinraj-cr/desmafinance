import { count, rupees, type BarMarker, type CardLine, type IncentiveCardView, type LadderStep } from "@/lib/crm-incentive-card";

/**
 * The incentive card on an L2 BDE's My Day: this month's enrolments against
 * their target, minimum and slabs, the provisional incentive so far, the
 * ladder and their team's pools. Everything it says comes from
 * `crm-incentive-card.ts`; this only lays it out.
 */

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined flex-none ${className}`} style={{ fontSize: 20 }} aria-hidden>
      {name}
    </span>
  );
}

/** Renders `**bold**` spans. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>))}
    </>
  );
}

function Lines({ lines, strong }: { lines: CardLine[]; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-xs text-label-sm">
      {lines.map((l) => (
        <div key={l.label} className="flex justify-between gap-sm">
          <span className={strong ? "text-on-surface" : "text-on-surface-variant"}>{l.label}</span>
          <span className={`whitespace-nowrap ${strong ? "font-bold text-accent" : "font-semibold text-on-surface"}`}>
            {l.approx ? "≈ " : ""}
            {rupees(l.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}

const shift = (pct: number) => (pct > 85 ? "-90%" : pct < 10 ? "-10%" : "-50%");

function markerColour(m: BarMarker): string {
  if (m.reached) return "text-green-700";
  return m.kind === "slab" ? "text-accent" : "text-on-surface";
}

/** Each label row is 18px; the bar sits 8px clear of the nearest row. */
const ROW = 18;

function Bar({ bar }: { bar: NonNullable<IncentiveCardView["bar"]> }) {
  const rows = (above: boolean) =>
    1 + Math.max(0, ...bar.markers.filter((m) => (m.kind === "slab") === above).map((m) => m.row));
  const top = rows(true) * ROW + 8;
  const bottom = rows(false) * ROW + 8;
  return (
    <div role="img" aria-label={bar.label} className="relative" style={{ paddingTop: top, paddingBottom: bottom }}>
      {bar.markers
        .filter((m) => m.kind === "slab")
        .map((m) => (
          <span
            key={`t-${m.at}`}
            className={`absolute whitespace-nowrap text-caption font-bold ${markerColour(m)}`}
            style={{ top: (rows(true) - 1 - m.row) * ROW, left: `${m.pct}%`, transform: `translateX(${shift(m.pct)})` }}
          >
            {m.label}
          </span>
        ))}
      <div className="h-[14px] overflow-hidden rounded-full bg-surface-container">
        <div className="h-full rounded-full bg-primary-container" style={{ width: `${Math.min(100, bar.fillPct)}%` }} />
      </div>
      {bar.markers.map((m) => (
        <span
          key={`m-${m.kind}-${m.at}`}
          className={`absolute h-[22px] w-[2px] ${m.reached ? "bg-green-700" : m.kind === "slab" ? "bg-accent" : "bg-on-surface"}`}
          style={{ top: top - 4, left: `${m.pct}%` }}
        />
      ))}
      {bar.markers
        .filter((m) => m.kind !== "slab")
        .map((m) => (
          <span
            key={`b-${m.kind}-${m.at}`}
            className={`absolute whitespace-nowrap text-caption font-semibold ${markerColour(m)}`}
            style={{ bottom: (rows(false) - 1 - m.row) * ROW, left: `${m.pct}%`, transform: `translateX(${shift(m.pct)})` }}
          >
            {m.label}
          </span>
        ))}
    </div>
  );
}

const STEP_STYLE: Record<LadderStep["state"], { box: string; icon: string; iconCls: string; note: string }> = {
  done: { box: "border border-green-200 bg-green-50", icon: "check_circle", iconCls: "text-green-700", note: "font-semibold text-green-700" },
  current: { box: "border border-green-200 bg-green-50", icon: "check_circle", iconCls: "text-green-700", note: "font-semibold text-green-700" },
  next: { box: "border-2 border-primary bg-primary-fixed/30", icon: "flag", iconCls: "text-accent", note: "text-on-surface" },
  ahead: { box: "border border-outline-variant bg-surface-container-lowest", icon: "arrow_upward", iconCls: "text-on-surface-variant", note: "text-on-surface-variant" },
};

function Ladder({ steps }: { steps: LadderStep[] }) {
  return (
    <div className="flex flex-col gap-sm px-lg pb-lg">
      <h3 className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">Your ladder this month</h3>
      <ol className="grid gap-sm" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
        {steps.map((s) => {
          const st = STEP_STYLE[s.state];
          return (
            <li key={s.title} className={`flex min-w-0 gap-sm rounded-lg px-md py-sm ${st.box}`}>
              <Icon name={st.icon} className={st.iconCls} />
              <div className="flex flex-col gap-[2px]">
                <span className="text-body-md font-bold text-on-surface">
                  {s.title}
                  {s.state === "next" && <span className="text-accent"> · next</span>}
                </span>
                <span className={`text-caption ${st.note}`}>{s.note}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Team({ team }: { team: NonNullable<IncentiveCardView["team"]> }) {
  return (
    <div className="mx-lg mb-lg flex flex-col gap-md rounded-lg border border-outline-variant p-lg">
      <div className="flex flex-wrap items-center justify-between gap-base">
        <h3 className="flex items-center gap-base text-body-lg font-bold text-on-surface">
          <Icon name="groups" className="text-on-surface-variant" />
          {team.name}
        </h3>
        <span className={`text-label-sm font-semibold ${team.eligible ? "text-green-700" : "text-amber-800"}`}>{team.status}</span>
      </div>
      {team.pools.length === 0 ? (
        <p className="text-label-sm text-on-surface-variant">No team target is set for this month yet.</p>
      ) : (
        <div className="flex flex-wrap gap-lg">
          {team.pools.map((p) => (
            <div key={p.label} className="flex min-w-0 flex-[1_1_300px] flex-col gap-base">
              <div className="flex justify-between gap-base text-label-sm">
                <span className="font-semibold text-on-surface">{p.label}</span>
                <span className="text-on-surface-variant">{rupees(p.pool)} pool</span>
              </div>
              <div
                className="h-[10px] overflow-hidden rounded-full bg-surface-container"
                role="progressbar"
                aria-label={p.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={p.pct}
              >
                <div className={`h-full rounded-full ${p.hit ? "bg-green-700" : "bg-primary-container"}`} style={{ width: `${p.pct}%` }} />
              </div>
              <span className="text-label-sm text-on-surface">
                <Rich text={p.text} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function IncentiveCard({ view, closedLine }: { view: IncentiveCardView; closedLine: string | null }) {
  return (
    <section aria-labelledby="incentive-h" className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-base bg-brand px-lg py-sm text-on-brand">
        <div className="flex flex-wrap items-baseline gap-sm">
          <h2 id="incentive-h" className="text-[18px] font-bold leading-6">
            {view.title}
          </h2>
          <span className="text-label-sm text-on-brand-variant">{view.daysNote}</span>
        </div>
        <a href="#incentive-how" className="inline-flex min-h-[44px] items-center text-label-sm font-semibold text-primary hover:underline">
          How my incentive is worked out
        </a>
      </div>

      {closedLine && (
        <p className="mx-lg mt-lg rounded-lg border border-dashed border-outline-variant p-sm text-label-sm text-on-surface-variant">
          <Rich text={closedLine} />
        </p>
      )}

      <div className="flex flex-wrap gap-xl p-lg">
        <div className="flex min-w-0 flex-[3_1_440px] flex-col gap-md">
          <div className="flex flex-wrap items-baseline gap-sm">
            <span className="text-[56px] font-extrabold leading-[56px] tracking-tight text-on-surface">{count(view.enrolled)}</span>
            <span className="text-body-lg text-on-surface-variant">
              enrolment{view.enrolled === 1 ? "" : "s"}
              {view.target > 0 ? ` · target ${count(view.target)}` : ""}
            </span>
            {view.pace && (
              <span
                className={`inline-flex items-center gap-xs rounded-full px-sm py-xs text-label-sm font-semibold ${
                  view.pace.good ? "bg-green-50 text-green-700" : "bg-error-container text-on-error-container"
                }`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>
                  {view.pace.good ? "trending_up" : "trending_down"}
                </span>
                {view.pace.label}
              </span>
            )}
          </div>

          {view.bar && <Bar bar={view.bar} />}

          {view.notice && (
            <p className="flex gap-sm rounded-lg bg-surface-container-low p-sm text-body-md text-on-surface">
              <Icon name="schedule" className="text-on-surface-variant" />
              <span>{view.notice}</span>
            </p>
          )}

          {view.next &&
            (view.belowSlabs ? (
              <p className="flex gap-sm rounded-lg bg-amber-50 p-sm text-body-md text-on-surface">
                <Icon name="lock" className="text-amber-800" />
                <span>
                  <Rich text={view.next} />
                </span>
              </p>
            ) : (
              <p className="text-body-lg text-on-surface">
                <Rich text={view.next} />
              </p>
            ))}
        </div>

        <div className="flex min-w-0 flex-[2_1_300px] flex-col gap-sm rounded-lg bg-surface-container-low p-lg">
          <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">Your incentive so far · provisional</span>
          <span className="text-[36px] font-extrabold leading-10 text-on-surface">{rupees(view.total)}</span>
          {view.lines.length > 0 && <Lines lines={view.lines} />}
          {view.ahead.length > 0 && (
            <>
              <div className="h-px bg-outline-variant" />
              <Lines lines={view.ahead} strong />
            </>
          )}
        </div>
      </div>

      {view.ladder.length > 0 && <Ladder steps={view.ladder} />}
      {view.team && <Team team={view.team} />}

      <p id="incentive-how" className="mx-lg mb-lg text-caption text-on-surface-variant">
        {view.explain}
      </p>
    </section>
  );
}
