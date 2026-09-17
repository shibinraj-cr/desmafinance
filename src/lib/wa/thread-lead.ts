/**
 * Which lead a number's WhatsApp thread should point at.
 *
 * One number carries several leads — a Meta re-inquiry filed as a duplicate, a
 * re-enrollment opened for a second service, an import that landed the same
 * person twice — but a number has exactly one thread, so the thread must pick
 * one. This is that choice, kept pure and away from Prisma because it is a
 * product rule rather than a query detail, and because the repair script that
 * re-points existing threads has to make exactly the same choice as the mirror.
 *
 * It used to be "oldest wins", which reads well and fails in the one case that
 * matters most: for an imported candidate the oldest row is routinely the
 * `duplicate` the importer flagged, so the thread bound to the row explicitly
 * marked as a copy while the lead anybody was working sat beside it. The inbox's
 * context rail then answered "Stage: Duplicate — Service: —" for a live
 * conversation, which is the wrong answer to the only question that rail exists
 * to answer.
 *
 * So the order is: a real row over a flagged copy, then a row somebody owns over
 * one nobody does, then the oldest — the original tie-break, kept, because among
 * equals the earliest record is the canonical one a re-inquiry folds onto.
 *
 * Note this does NOT decide who may reply. Permission is asked separately, and
 * across every lead on the number (see ./access), precisely so that a thread
 * bound to the wrong row cannot lock a consultant out of their own candidate.
 * Binding is about which record a thread is FILED under, not who owns it.
 */

/**
 * The importer's dedup flag — a stage meaning "this row is a copy, the real
 * record is elsewhere". Matched by code rather than by the `parked` flag: a
 * parked stage (re-marketing) is still a genuine record somebody may be working,
 * while a duplicate is by definition not the record to file a thread under.
 */
export const DUPLICATE_STATUS_CODE = "duplicate";

export type ThreadLeadCandidate = {
  id: string;
  assignedToId: string | null;
  /** `CrmLeadStatus.code`, null when the lead has no stage. */
  statusCode: string | null;
  createdAt: Date;
};

/** Lower sorts first. */
function rank(lead: ThreadLeadCandidate): [number, number, number] {
  return [
    lead.statusCode === DUPLICATE_STATUS_CODE ? 1 : 0,
    lead.assignedToId ? 0 : 1,
    lead.createdAt.getTime(),
  ];
}

/**
 * Pick the lead a thread on this number belongs to, or null when the number has
 * no leads at all.
 *
 * Total and deterministic: ties fall through to the lead id, so two webhook
 * deliveries racing on the same number cannot pick differently and leave the
 * link flapping between two equally-ranked rows.
 */
export function pickThreadLead<T extends ThreadLeadCandidate>(leads: readonly T[]): T | null {
  let best: T | null = null;
  let bestRank: [number, number, number] | null = null;

  for (const lead of leads) {
    const r = rank(lead);
    if (!bestRank) {
      best = lead;
      bestRank = r;
      continue;
    }
    const cmp = r[0] - bestRank[0] || r[1] - bestRank[1] || r[2] - bestRank[2];
    if (cmp < 0 || (cmp === 0 && lead.id < best!.id)) {
      best = lead;
      bestRank = r;
    }
  }

  return best;
}
