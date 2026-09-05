import type { ApplicationRowDTO } from "./candidates";

/**
 * Columns for the cross-requisition pipeline board.
 *
 * Stages belong to a JOB, and every job may rename and reorder its own. So a
 * board spanning every live req cannot key columns on a stage id or a name —
 * it keys them on `position`, exactly as analytics do, and labels each column
 * with the name most jobs use at that position.
 *
 * That is why dropping a card is expressed as "move to position N of THIS
 * card's job", resolved per-card, rather than "move to stage X".
 */

export type BoardColumn = {
  position: number;
  label: string;
  kind: string;
  /** Every stage id that sits at this position, across the jobs on the board. */
  stageIds: string[];
};

export type StageLite = { id: string; jobId: string; name: string; kind: string; position: number };

export function buildBoardColumns(stages: StageLite[]): BoardColumn[] {
  const byPosition = new Map<number, StageLite[]>();
  for (const s of stages) {
    if (!byPosition.has(s.position)) byPosition.set(s.position, []);
    byPosition.get(s.position)!.push(s);
  }

  return [...byPosition.entries()]
    .sort(([a], [b]) => a - b)
    .map(([position, group]) => ({
      position,
      label: mostCommon(group.map((s) => s.name)),
      kind: mostCommon(group.map((s) => s.kind)),
      stageIds: group.map((s) => s.id),
    }));
}

/** The stage a given job uses at a board position, or null when it has none. */
export function stageForJobAtPosition(
  stages: StageLite[],
  jobId: string,
  position: number,
): StageLite | null {
  return stages.find((s) => s.jobId === jobId && s.position === position) ?? null;
}

export function groupCardsByPosition(
  cards: ApplicationRowDTO[],
  columns: BoardColumn[],
): Map<number, ApplicationRowDTO[]> {
  const out = new Map<number, ApplicationRowDTO[]>();
  for (const c of columns) out.set(c.position, []);
  for (const card of cards) {
    if (card.stagePosition == null) continue;
    // A card whose job has a position the board does not show (a job with a
    // longer pipeline than the rest) still needs somewhere to live: it lands in
    // the last column rather than vanishing.
    const bucket = out.has(card.stagePosition)
      ? card.stagePosition
      : (columns[columns.length - 1]?.position ?? null);
    if (bucket == null) continue;
    out.get(bucket)!.push(card);
  }
  return out;
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? "";
  let bestCount = 0;
  for (const [v, n] of counts) {
    // Ties break alphabetically so the board's labels are stable between reads
    // rather than depending on which job happened to be queried first.
    if (n > bestCount || (n === bestCount && v.localeCompare(best) < 0)) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}
