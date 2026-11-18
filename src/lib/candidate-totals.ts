/**
 * What each candidate owes, has paid, and still owes, for the Approvals
 * queue, so a reviewer can check a payment against the candidate's total
 * without opening the candidate page.
 *
 * The figures match that page's "Totals" box exactly:
 *   quoted  = sum of the candidate's service amounts (PartyService)
 *   paid    = every approved Revenue row for the candidate, INCLUDING
 *             payments from before DesGro (they exist for this balance)
 *   balance = quoted − paid
 * Rows still waiting for approval are not counted as paid.
 */
import { prisma } from "@/lib/prisma";

export type CandidateTotals = {
  /** Sum of the candidate's service amounts. 0 when none is set. */
  quoted: number;
  /** Approved payments received so far. */
  paid: number;
  balance: number;
  /** Number of services on the candidate. */
  services: number;
};

type DecimalLike = { toString(): string } | number | null | undefined;

const num = (v: DecimalLike) => (v === null || v === undefined ? 0 : Number(v.toString()));

/** Pure: combine the two query results into per-candidate totals. */
export function buildCandidateTotals(
  candidates: { id: string; partyServices: { totalAmount: DecimalLike }[] }[],
  paidRows: { partyId: string | null; _sum: { amount: DecimalLike } }[],
): Record<string, CandidateTotals> {
  const paidById = new Map<string, number>();
  for (const r of paidRows) {
    if (r.partyId) paidById.set(r.partyId, num(r._sum.amount));
  }
  const out: Record<string, CandidateTotals> = {};
  for (const c of candidates) {
    const quoted = c.partyServices.reduce((s, ps) => s + num(ps.totalAmount), 0);
    const paid = paidById.get(c.id) ?? 0;
    out[c.id] = { quoted, paid, balance: quoted - paid, services: c.partyServices.length };
  }
  return out;
}

/** Totals for those of `partyIds` that are Candidates; other ids are left out. */
export async function loadCandidateTotals(
  partyIds: string[],
): Promise<Record<string, CandidateTotals>> {
  const ids = Array.from(new Set(partyIds.filter(Boolean)));
  if (ids.length === 0) return {};
  const candidates = await prisma.party.findMany({
    where: { id: { in: ids }, group: "Candidate" },
    select: { id: true, partyServices: { select: { totalAmount: true } } },
  });
  if (candidates.length === 0) return {};
  const paidRows = await prisma.transaction.groupBy({
    by: ["partyId"],
    where: {
      partyId: { in: candidates.map((c) => c.id) },
      type: "Revenue",
      deletedAt: null,
    },
    _sum: { amount: true },
  });
  return buildCandidateTotals(candidates, paidRows);
}
