/**
 * One-off recovery for pending Revenue approvals whose EXP/DOM was lost.
 *
 * Background: draftFirst users (e.g. Ganga) enter transactions as
 * TransactionDrafts, then promote them via submitDraftToPending(). A bug
 * in that promotion dropped `expDom` from the rebuilt proposed payload,
 * so every Revenue item they submitted reached the approval queue with a
 * blank EXP/DOM (rendered as "—") and fell out of the GST liability calc.
 *
 * The original value is still recoverable: expDom is mandatory on every
 * Revenue draft, and the draft's DRAFT_CREATE / DRAFT_UPDATE audit entry
 * recorded it. We walk:
 *
 *   PendingApproval (proposed.expDom missing, type=Revenue)
 *     → its SUBMIT_CREATE AuditLog entry  (changes.fromDraftId)
 *       → that draft's latest DRAFT_* AuditLog entry  (changes.expDom)
 *
 * and patch PendingApproval.proposed.expDom in place. approvePending()
 * already copies proposed.expDom onto the Transaction, so fixing the
 * pending rows is enough — they'll approve with the right value even
 * before the code fix deploys.
 *
 * Safe + idempotent. Dry-run by default; pass --apply to write.
 *   npm run db:backfill-pending-expdom          # dry run, report only
 *   npm run db:backfill-pending-expdom -- --apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");

type Json = Record<string, unknown>;

function asObj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

/** Normalise a recovered value to "EXP" | "DOM" | null. */
function normExpDom(v: unknown): "EXP" | "DOM" | null {
  return v === "EXP" || v === "DOM" ? v : null;
}

async function main() {
  console.log(
    `EXP/DOM backfill for pending Revenue approvals — ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}\n`,
  );

  // Pending create rows only. Updates carry expDom through submitUpdate()
  // already; deletes have no proposed payload.
  const pendings = await prisma.pendingApproval.findMany({
    where: { status: "pending", kind: "create" },
    select: { id: true, proposed: true, createdAt: true, submittedById: true },
    orderBy: { createdAt: "asc" },
  });

  let scanned = 0;
  let alreadyOk = 0;
  let recovered = 0;
  let unrecoverable = 0;
  const misses: Array<{ id: string; reason: string }> = [];

  for (const p of pendings) {
    const proposed = asObj(p.proposed);
    if (!proposed) continue;
    if (proposed.type !== "Revenue") continue;
    scanned++;

    if (normExpDom(proposed.expDom)) {
      alreadyOk++;
      continue;
    }

    // Step 1: find the draft id this pending row was promoted from.
    const submitAudit = await prisma.auditLog.findFirst({
      where: { entityType: "PendingApproval", entityId: p.id, action: "SUBMIT_CREATE" },
      orderBy: { createdAt: "desc" },
    });
    const fromDraftId = asObj(submitAudit?.changes)?.fromDraftId;
    if (typeof fromDraftId !== "string") {
      unrecoverable++;
      misses.push({ id: p.id, reason: "no SUBMIT_CREATE audit / fromDraftId" });
      continue;
    }

    // Step 2: read expDom from the draft's latest DRAFT_* audit entry.
    const draftAudits = await prisma.auditLog.findMany({
      where: {
        entityType: "TransactionDraft",
        entityId: fromDraftId,
        action: { in: ["DRAFT_UPDATE", "DRAFT_CREATE"] },
      },
      orderBy: { createdAt: "desc" },
    });
    let value: "EXP" | "DOM" | null = null;
    for (const a of draftAudits) {
      const v = normExpDom(asObj(a.changes)?.expDom);
      if (v) {
        value = v;
        break;
      }
    }
    if (!value) {
      unrecoverable++;
      misses.push({ id: p.id, reason: `draft ${fromDraftId.slice(0, 8)} audit has no expDom` });
      continue;
    }

    console.log(
      `  ${APPLY ? "✓" : "•"} ${p.id.slice(0, 8)} · ${String(proposed.subItem ?? "")} · ₹${proposed.amount ?? "?"} → ${value}`,
    );
    if (APPLY) {
      proposed.expDom = value;
      await prisma.pendingApproval.update({
        where: { id: p.id },
        data: { proposed: proposed as object },
      });
    }
    recovered++;
  }

  // Informational: how many already-approved Revenue transactions also
  // have a blank expDom (same bug, separate fix — not touched here).
  const approvedBlank = await prisma.transaction.count({
    where: { type: "Revenue", deletedAt: null, expDom: null },
  });

  console.log("\nSummary:");
  console.log({
    pendingCreateRows: pendings.length,
    revenueScanned: scanned,
    alreadyHadExpDom: alreadyOk,
    recovered,
    unrecoverable,
    applied: APPLY,
  });
  if (misses.length) {
    console.log("\nUnrecoverable rows (need manual EXP/DOM):");
    for (const m of misses) console.log(`  - ${m.id} :: ${m.reason}`);
  }
  if (approvedBlank > 0) {
    console.log(
      `\nNote: ${approvedBlank} already-approved Revenue transaction(s) also have a blank EXP/DOM (same root cause). This script does not touch approved rows — ask if you want a companion backfill for those.`,
    );
  }
  if (!APPLY && recovered > 0) {
    console.log("\nDry run only. Re-run with --apply to write these changes.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
