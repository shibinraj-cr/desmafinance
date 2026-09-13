/**
 * SOP number minting — "OPS-SOP-001".
 *
 * The number is the SOP's permanent identity (§2): minted once at creation and
 * never reissued, even if the SOP later changes department, title or owner.
 *
 * Concurrency: two people creating an Operations SOP at the same instant would
 * both read the same `max(seq)`. Rather than serialise every creation behind a
 * lock, we let the unique constraints on `Sop.sopNumber` and `(deptCode, seq)`
 * be the arbiter and retry the loser — the cheap path stays cheap, and the
 * database, not application timing, guarantees uniqueness.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { conflict } from "@/lib/http-error";
import { deriveDeptCode, formatSopNumber } from "./constants";

export type MintedNumber = { sopNumber: string; deptCode: string; seq: number };

/** The next free sequence for a code, given what is already minted. */
export async function nextSeqForCode(
  deptCode: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const agg = await client.sop.aggregate({ where: { deptCode }, _max: { seq: true } });
  return (agg._max.seq ?? 0) + 1;
}

/**
 * The code a department's SOPs are numbered under. Falls back to the derived
 * code when the department is unknown or the SOP has none.
 */
export async function deptCodeFor(departmentId: string | null | undefined): Promise<string> {
  if (!departmentId) return deriveDeptCode(null);
  const dept = await prisma.hrDepartment.findUnique({
    where: { id: departmentId },
    select: { name: true },
  });
  return deriveDeptCode(dept?.name ?? null);
}

/**
 * Run `create` with a freshly minted number, retrying on the unique-constraint
 * collision that a concurrent creation causes.
 *
 * The retry is bounded: five attempts is far more than a real collision needs,
 * and an unbounded loop on a genuinely broken constraint would spin.
 */
export async function withMintedNumber<T>(
  deptCode: string,
  create: (minted: MintedNumber) => Promise<T>,
  attempts = 5,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    const seq = await nextSeqForCode(deptCode);
    const minted: MintedNumber = { deptCode, seq, sopNumber: formatSopNumber(deptCode, seq) };
    try {
      return await create(minted);
    } catch (e) {
      if (isUniqueViolation(e) && i < attempts - 1) continue;
      if (isUniqueViolation(e)) {
        throw conflict(
          "Could not allocate an SOP number — too many SOPs were created at once. Please try again.",
          "sop_number_contention",
        );
      }
      throw e;
    }
  }
  // Unreachable: the loop either returns or throws.
  throw conflict("Could not allocate an SOP number.", "sop_number_contention");
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2002"
  );
}
