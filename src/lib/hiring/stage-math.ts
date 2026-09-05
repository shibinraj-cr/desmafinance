/**
 * Pure stage arithmetic — no database, no React.
 *
 * Deliberately its own file: both the server-side move path and the client-side
 * list rendering need these, and putting them in `pipeline.ts` meant a Kanban
 * card importing `daysInStage` also imported the automation engine.
 */

/** The application status implied by a stage's kind. */
export function statusForStageKind(kind: string, current: string): string {
  if (kind === "won") return "hired";
  if (kind === "lost") return "rejected";
  if (kind === "hold") return "on_hold";
  // Moving back into an open stage reactivates a rejected/held application —
  // that IS what dragging the card back means.
  return current === "withdrawn" ? "withdrawn" : "active";
}

/** SLA breach: longer in the current stage than that stage allows. */
export function isSlaBreached(
  app: { stageEnteredAt: Date; status: string },
  stage: { slaDays: number | null; kind: string } | null,
  now: Date = new Date(),
): boolean {
  if (!stage?.slaDays || stage.kind !== "open") return false;
  if (app.status !== "active") return false;
  const days = (now.getTime() - app.stageEnteredAt.getTime()) / 86_400_000;
  return days > stage.slaDays;
}

/** Whole days the application has sat in its current stage. */
export function daysInStage(app: { stageEnteredAt: Date }, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - app.stageEnteredAt.getTime()) / 86_400_000));
}
