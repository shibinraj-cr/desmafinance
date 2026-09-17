/**
 * REPAIR — re-point WhatsApp threads that are filed under the wrong lead.
 *
 * Root cause (fixed in src/lib/wa/mirror.ts `findLeadByPhone`): one number
 * carries several leads but exactly one thread, and the mirror used to bind the
 * thread to the OLDEST of them. For an imported candidate the oldest row is
 * routinely the one the importer flagged `duplicate`, so the thread filed itself
 * under the row explicitly marked as a copy and the inbox's context rail
 * answered "Stage: Duplicate" for a live conversation.
 *
 * The mirror re-resolves the link on every inbound message, so an active thread
 * repairs itself the next time its candidate writes in. This script is for the
 * ones that are idle — and for fixing the rail now rather than whenever the
 * candidate happens to reply.
 *
 * Uses the SAME picker as the mirror (src/lib/wa/thread-lead.ts), so the repair
 * and the live path can never disagree about where a thread belongs.
 *
 * Touches `WaConversation.leadId` only — never a message, never a lead. The
 * owner column is filled just where it is empty (what the mirror itself does for
 * an ownerless thread); a thread somebody already holds is left with them,
 * because handing a thread to a colleague is a deliberate act the inbox allows.
 *
 * DRY-RUN by default — writes only with COMMIT=1.
 *
 *   npx tsx prisma/repair-wa-thread-lead.ts
 *   COMMIT=1 npx tsx prisma/repair-wa-thread-lead.ts
 *
 * IMPORTANT: your .env DATABASE_URL is PRODUCTION. Read the dry-run output in
 * full before setting COMMIT=1. No candidate names or numbers are printed —
 * this repo is public — so rows are identified by id and stage code.
 */
import { PrismaClient } from "@prisma/client";
import { pickThreadLead, DUPLICATE_STATUS_CODE } from "../src/lib/wa/thread-lead";

const prisma = new PrismaClient();

const COMMIT = process.env.COMMIT === "1";
/** Rows per page — the scan is over every thread, so it is deliberately chunked. */
const PAGE = Number(process.env.PAGE ?? 500);

const log = (...a: unknown[]) => console.log(...a);
/** Last 4 digits only — enough to correlate with the inbox, no number in the log. */
const tail = (phone: string) => `…${phone.slice(-4)}`;

type Move = {
  conversationId: string;
  phoneTail: string;
  fromLeadId: string | null;
  fromStatus: string | null;
  toLeadId: string;
  toStatus: string | null;
  claimsOwner: string | null;
};

async function main() {
  log(`[repair-wa-thread-lead] ${COMMIT ? "*** COMMIT ***" : "DRY-RUN"}\n`);

  const moves: Move[] = [];
  let scanned = 0;
  let orphaned = 0;
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.waConversation.findMany({
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        phoneE164: true,
        leadId: true,
        assignedToId: true,
        lead: { select: { id: true, status: { select: { code: true } } } },
      },
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;
    scanned += page.length;

    for (const conv of page) {
      const leads = await prisma.lead.findMany({
        where: { OR: [{ phoneE164: conv.phoneE164 }, { altPhoneE164: conv.phoneE164 }] },
        select: {
          id: true,
          assignedToId: true,
          createdAt: true,
          status: { select: { code: true } },
        },
      });

      const picked = pickThreadLead(
        leads.map((l) => ({
          id: l.id,
          assignedToId: l.assignedToId,
          statusCode: l.status?.code ?? null,
          createdAt: l.createdAt,
        })),
      );

      // No lead on this number at all. Left alone deliberately: the thread still
      // holds the candidate's messages, and inventing a link would be worse than
      // an unlinked thread the inbox already knows how to show.
      if (!picked) {
        if (!conv.leadId) orphaned += 1;
        continue;
      }
      if (picked.id === conv.leadId) continue;

      moves.push({
        conversationId: conv.id,
        phoneTail: tail(conv.phoneE164),
        fromLeadId: conv.leadId,
        fromStatus: conv.lead?.status?.code ?? null,
        toLeadId: picked.id,
        toStatus: leads.find((l) => l.id === picked.id)?.status?.code ?? null,
        claimsOwner: conv.assignedToId ? null : picked.assignedToId,
      });
    }
  }

  log(`  scanned ${scanned} thread(s); ${orphaned} have no lead on their number (left as-is)\n`);

  if (moves.length === 0) {
    log("  nothing to re-point — every thread is already on its best lead.");
    return;
  }

  const offDuplicate = moves.filter((m) => m.fromStatus === DUPLICATE_STATUS_CODE).length;
  const fromUnlinked = moves.filter((m) => !m.fromLeadId).length;
  const ownerFills = moves.filter((m) => m.claimsOwner).length;

  log(`  ${moves.length} thread(s) to re-point:`);
  log(`    ${offDuplicate} off a lead flagged "${DUPLICATE_STATUS_CODE}"`);
  log(`    ${fromUnlinked} from no lead at all`);
  log(`    ${ownerFills} would also gain an owner (currently unassigned)\n`);

  for (const m of moves) {
    log(
      `    ${m.phoneTail}  conv=${m.conversationId}  ${m.fromLeadId ?? "(unlinked)"} [${m.fromStatus ?? "—"}]` +
        ` -> ${m.toLeadId} [${m.toStatus ?? "—"}]${m.claimsOwner ? "  +owner" : ""}`,
    );
  }

  if (!COMMIT) {
    log(`\n  DRY-RUN — nothing written. Re-run with COMMIT=1 to apply.`);
    return;
  }

  let applied = 0;
  for (const m of moves) {
    await prisma.waConversation.update({
      where: { id: m.conversationId },
      data: {
        leadId: m.toLeadId,
        ...(m.claimsOwner ? { assignedToId: m.claimsOwner } : {}),
      },
    });
    applied += 1;
  }
  log(`\n  re-pointed ${applied} thread(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
