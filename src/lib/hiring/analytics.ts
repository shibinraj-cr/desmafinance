/**
 * Hiring analytics.
 *
 * Every number here is computed from `HiringApplicationEvent` — never from the
 * current state of an application. That is not a stylistic choice: an
 * application's `stageId` tells you where somebody is NOW, so counting it would
 * report that a candidate who was rejected at Offer never reached Interview.
 * The funnel has to be "how many applications ever reached this stage", and
 * only the event log knows that.
 *
 * It also makes the numbers checkable: §9's acceptance test is that these
 * reconcile against a manual count of the same events over the same range, and
 * the pure functions below are exactly that count.
 */

export type AnalyticsEvent = {
  applicationId: string;
  type: string;
  fromStage: string | null;
  toStage: string | null;
  occurredAt: Date;
};

/** A stage identified the way analytics may identify one: by kind and position. */
export type StageKey = { position: number; kind: string; label: string };

export type FunnelStep = {
  position: number;
  label: string;
  kind: string;
  /** Distinct applications that EVER reached this stage in the range. */
  reached: number;
  /** Of those, how many went on to the next step. */
  advanced: number;
  /** advanced / reached, as a percentage. Null when nobody reached it. */
  conversionPct: number | null;
};

/**
 * Which stage positions each application reached, from its events.
 *
 * `created` counts as reaching position 0 — an application that arrived and was
 * never moved has still entered the funnel, and leaving it out would understate
 * the top of every funnel by exactly the candidates nobody looked at.
 */
export function reachedPositionsByApplication(
  events: AnalyticsEvent[],
  stageByLabel: Map<string, StageKey>,
): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const add = (appId: string, position: number) => {
    if (!out.has(appId)) out.set(appId, new Set());
    out.get(appId)!.add(position);
  };

  for (const e of events) {
    if (e.type === "created") {
      const key = e.toStage ? stageByLabel.get(normalize(e.toStage)) : undefined;
      add(e.applicationId, key?.position ?? 0);
      continue;
    }
    if (e.type !== "stage_moved" && e.type !== "rejected") continue;
    if (!e.toStage) continue;
    const key = stageByLabel.get(normalize(e.toStage));
    if (key) add(e.applicationId, key.position);
  }
  return out;
}

/** The funnel, as counts of applications that ever reached each step. */
export function buildFunnel(events: AnalyticsEvent[], stages: StageKey[]): FunnelStep[] {
  const byLabel = new Map(stages.map((s) => [normalize(s.label), s]));
  const reached = reachedPositionsByApplication(events, byLabel);

  // Only the open stages form the funnel; won/lost/hold are outcomes, not steps.
  const steps = stages.filter((s) => s.kind === "open").sort((a, b) => a.position - b.position);

  const counts = steps.map(
    (s) => [...reached.values()].filter((positions) => positions.has(s.position)).length,
  );

  return steps.map((s, i) => {
    const reachedCount = counts[i]!;
    // "Advanced" is how many of THIS step's arrivals also reached the next one,
    // not the next step's total — those differ whenever someone skips a stage.
    const advanced =
      i === steps.length - 1
        ? 0
        : [...reached.values()].filter(
            (positions) => positions.has(s.position) && positions.has(steps[i + 1]!.position),
          ).length;
    return {
      position: s.position,
      label: s.label,
      kind: s.kind,
      reached: reachedCount,
      advanced,
      conversionPct: reachedCount === 0 ? null : Math.round((advanced / reachedCount) * 100),
    };
  });
}

export type TimeToHire = { count: number; medianDays: number | null; averageDays: number | null };

/**
 * Days from the `created` event to the hire.
 *
 * A hire is a move into a WON stage, and won stages are named per job, so the
 * caller passes the set of labels that count. Keying on a stage's name inside
 * this function would break the moment one job renamed "Hired" to "Joined".
 */
export function timeToHire(events: AnalyticsEvent[], wonLabels: Set<string>): TimeToHire {
  const won = new Set([...wonLabels].map(normalize));
  const created = new Map<string, Date>();
  const hired = new Map<string, Date>();

  for (const e of events) {
    if (e.type === "created" && !created.has(e.applicationId)) {
      created.set(e.applicationId, e.occurredAt);
    }
    if (e.type === "stage_moved" && e.toStage && won.has(normalize(e.toStage))) {
      // The LAST such move wins: someone re-hired after a reversal was hired
      // when they actually joined, not the first time the card was dragged.
      hired.set(e.applicationId, e.occurredAt);
    }
  }

  const spans: number[] = [];
  for (const [appId, hiredAt] of hired) {
    const start = created.get(appId);
    if (!start) continue;
    spans.push((hiredAt.getTime() - start.getTime()) / 86_400_000);
  }
  return summarise(spans);
}

export type StageDwell = { label: string; count: number; averageDays: number | null };

/**
 * How long applications sat in each stage, from consecutive move events.
 * An application still sitting somewhere contributes nothing — the dwell is
 * only known once they leave, and guessing at the open ones would drift the
 * average towards whatever today happens to be.
 */
export function timeInStage(events: AnalyticsEvent[]): StageDwell[] {
  const byApp = new Map<string, AnalyticsEvent[]>();
  for (const e of events) {
    if (e.type !== "stage_moved" && e.type !== "created" && e.type !== "rejected") continue;
    if (!byApp.has(e.applicationId)) byApp.set(e.applicationId, []);
    byApp.get(e.applicationId)!.push(e);
  }

  const spans = new Map<string, number[]>();
  for (const list of byApp.values()) {
    const ordered = [...list].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    for (let i = 0; i < ordered.length - 1; i++) {
      const stage = ordered[i]!.toStage;
      if (!stage) continue;
      const days = (ordered[i + 1]!.occurredAt.getTime() - ordered[i]!.occurredAt.getTime()) / 86_400_000;
      if (!spans.has(stage)) spans.set(stage, []);
      spans.get(stage)!.push(days);
    }
  }

  return [...spans.entries()]
    .map(([label, values]) => ({
      label,
      count: values.length,
      averageDays: values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null,
    }))
    .sort((a, b) => (b.averageDays ?? 0) - (a.averageDays ?? 0));
}

export type OfferOutcome = { sent: number; signed: number; acceptRatePct: number | null };

/** Offer accept rate, from the offer_sent and offer_signed events. */
export function offerOutcomes(events: AnalyticsEvent[]): OfferOutcome {
  const sent = new Set(events.filter((e) => e.type === "offer_sent").map((e) => e.applicationId));
  const signed = new Set(events.filter((e) => e.type === "offer_signed").map((e) => e.applicationId));
  return {
    sent: sent.size,
    signed: signed.size,
    // Counted over offers SENT in the range, so a rate above 100% is impossible
    // even when a signature lands after the window it was sent in.
    acceptRatePct: sent.size === 0 ? null : Math.round(([...signed].filter((id) => sent.has(id)).length / sent.size) * 100),
  };
}

function summarise(values: number[]): TimeToHire {
  if (!values.length) return { count: 0, medianDays: null, averageDays: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return {
    count: values.length,
    medianDays: round1(median),
    averageDays: round1(values.reduce((a, b) => a + b, 0) / values.length),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function normalize(label: string): string {
  return label.trim().toLowerCase();
}

// ── Reporting helpers ──────────────────────────────────────────────────────

export const REPORT_DIMENSIONS = ["source", "department", "job", "stage", "owner"] as const;
export type ReportDimension = (typeof REPORT_DIMENSIONS)[number];

export const REPORT_MEASURES = ["applications", "hires", "offers", "avgScore"] as const;
export type ReportMeasure = (typeof REPORT_MEASURES)[number];

export const DIMENSION_LABELS: Record<ReportDimension, string> = {
  source: "Source",
  department: "Department",
  job: "Requisition",
  stage: "Current stage",
  owner: "Owner",
};

export const MEASURE_LABELS: Record<ReportMeasure, string> = {
  applications: "Applications",
  hires: "Hires",
  offers: "Offers sent",
  avgScore: "Average AI score",
};

export type ReportRow = { key: string; label: string } & Record<string, number | string | null>;

/** CSV for any analytics table — same escaping rules as the other exports. */
export function reportToCsv(headers: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}
