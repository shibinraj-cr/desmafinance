/**
 * REPAIR — WhatsApp threads still owned by a consultant who no longer owns the lead.
 *
 * The inbox's consultant filter reads the thread's own `assignedToId`, a copy of
 * a lead's owner that drifts from it: assignments made before threads were
 * synced, deleted leads, a sync that failed quietly. The mirror used to fill
 * that column only when it was empty, so drift was never corrected. A reply on
 * a lead nobody owned was then filed under a former consultant and never
 * reached the dispatcher's "Unassigned + Needs reply".
 *
 * The mirror now corrects a thread on its next inbound message. This script
 * does to every thread now exactly what the mirror would do if its candidate
 * wrote in this minute, which matters for replies already sitting in the wrong
 * queue:
 *   - files it under the lead the mirror would pick (`pickThreadLead` — a real
 *     row over a `duplicate`, an owned one over an unowned one, then oldest);
 *   - sets its owner by the mirror's rule (`threadOwnerAfterInbound`).
 * Both directions are fixed: a thread kept by a consultant who no longer owns
 * any real lead on the number, and an ownerless thread whose lead IS owned
 * (it sat in "Unassigned", where picking an Owner would reassign a lead that
 * already had one).
 *
 * Touches `WaConversation.leadId` / `assignedToId` only — never a message,
 * never a lead. Kept as-is:
 *   - threads with no lead on their number (no record to correct them against);
 *   - an owner who still holds a real lead on the number (the thread follows
 *     whichever sibling was assigned last).
 *
 * DRY-RUN by default — writes only with COMMIT=1.
 *
 *   npx tsx prisma/repair-wa-thread-owner.ts
 *   COMMIT=1 npx tsx prisma/repair-wa-thread-owner.ts
 *
 * IMPORTANT: your .env DATABASE_URL is PRODUCTION. Read the dry-run output in
 * full before setting COMMIT=1. No candidate names or numbers are printed —
 * this repo is public — so rows are identified by id.
 */
import { PrismaClient } from "@prisma/client";
import { pickThreadLead, threadOwnerAfterInbound, type ThreadLeadCandidate } from "../src/lib/wa/thread-lead";

const prisma = new PrismaClient();

const COMMIT = process.env.COMMIT === "1";
/** Rows per page — the scan is over every thread, so it is chunked. */
const PAGE = Number(process.env.PAGE ?? 500);

const log = (...a: unknown[]) => console.log(...a);

type Fix = {
  conversationId: string;
  fromLeadId: string | null;
  toLeadId: string;
  from: string | null;
  to: string | null;
  awaitingReply: boolean;
  open: boolean;
};

async function main() {
  log(`[repair-wa-thread-owner] ${COMMIT ? "*** COMMIT ***" : "DRY-RUN"}\n`);

  const fixes: Fix[] = [];
  let scanned = 0;
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.waConversation.findMany({
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, phoneE164: true, leadId: true, assignedToId: true, status: true, awaitingReply: true },
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;
    scanned += page.length;

    // Every lead on this page's numbers in ONE query — a query per thread is
    // thousands of round trips against a remote database.
    const phones = [...new Set(page.map((c) => c.phoneE164))];
    const pageLeads = await prisma.lead.findMany({
      where: { OR: [{ phoneE164: { in: phones } }, { altPhoneE164: { in: phones } }] },
      select: {
        id: true,
        assignedToId: true,
        createdAt: true,
        phoneE164: true,
        altPhoneE164: true,
        status: { select: { code: true } },
      },
    });
    const wanted = new Set(phones);
    const byPhone = new Map<string, ThreadLeadCandidate[]>();
    for (const l of pageLeads) {
      const candidate: ThreadLeadCandidate = {
        id: l.id,
        assignedToId: l.assignedToId,
        statusCode: l.status?.code ?? null,
        createdAt: l.createdAt,
      };
      for (const phone of new Set([l.phoneE164, l.altPhoneE164])) {
        if (!phone || !wanted.has(phone)) continue;
        const bucket = byPhone.get(phone);
        if (bucket) bucket.push(candidate);
        else byPhone.set(phone, [candidate]);
      }
    }

    for (const conv of page) {
      const leads = byPhone.get(conv.phoneE164) ?? [];
      const picked = pickThreadLead(leads);
      if (!picked) continue;
      const nextOwner = threadOwnerAfterInbound({ current: conv.assignedToId, lead: picked, numberLeads: leads });
      const to = nextOwner === undefined ? conv.assignedToId : nextOwner;
      if (picked.id === conv.leadId && to === conv.assignedToId) continue;
      fixes.push({
        conversationId: conv.id,
        fromLeadId: conv.leadId,
        toLeadId: picked.id,
        from: conv.assignedToId,
        to,
        awaitingReply: conv.awaitingReply,
        open: conv.status !== "closed",
      });
    }

    log(`  …scanned ${scanned} thread(s), ${fixes.length} to correct so far`);
  }

  log(`\n  scanned ${scanned} thread(s)\n`);

  if (fixes.length === 0) {
    log("  nothing to correct — every thread is on the lead and owner the mirror would choose.");
    return;
  }

  const ownerChanges = fixes.filter((f) => f.to !== f.from);
  const released = ownerChanges.filter((f) => f.from !== null && f.to === null);
  const surfacing = released.filter((f) => f.open && f.awaitingReply).length;
  const moved = ownerChanges.filter((f) => f.from !== null && f.to !== null);
  const claimed = ownerChanges.filter((f) => f.from === null);
  const relinked = fixes.filter((f) => f.toLeadId !== f.fromLeadId).length;

  log(`  ${fixes.length} thread(s) to correct:`);
  log(`    ${released.length} owner -> Unassigned (the owner no longer has any real lead on the number)`);
  log(`       of which ${surfacing} are open AND waiting for a reply — these appear in "Unassigned + Needs reply"`);
  log(`    ${moved.length} owner -> the lead's current owner`);
  log(`    ${claimed.length} Unassigned -> the lead's owner (leaves the Unassigned list)`);
  log(`    ${relinked} re-filed under a different lead on the same number\n`);

  for (const f of fixes) {
    log(
      `    conv=${f.conversationId}  lead ${f.fromLeadId ?? "(none)"} -> ${f.toLeadId}` +
        `  owner ${f.from ?? "(unassigned)"} -> ${f.to ?? "(unassigned)"}` +
        `${f.open ? "" : "  [closed]"}${f.awaitingReply ? "  [needs reply]" : ""}`,
    );
  }

  if (!COMMIT) {
    log(`\n  DRY-RUN — nothing written. Re-run with COMMIT=1 to apply.`);
    return;
  }

  let applied = 0;
  for (const f of fixes) {
    // Guarded on what we read, so a reassignment (or an inbound message
    // re-filing the thread) made while this ran is never overwritten.
    const r = await prisma.waConversation.updateMany({
      where: { id: f.conversationId, assignedToId: f.from, leadId: f.fromLeadId },
      data: { leadId: f.toLeadId, assignedToId: f.to },
    });
    applied += r.count;
  }
  log(`\n  corrected ${applied} of ${fixes.length} thread(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
