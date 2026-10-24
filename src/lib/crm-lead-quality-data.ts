/**
 * Lead quality, server side: validating and writing a rating, and the queries
 * behind the reminder pop-up. The rules themselves are pure and live in
 * crm-lead-quality.ts so the client shares them.
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import { badRequest } from "./http-error";
import {
  LEAD_QUALITY_RATINGS,
  QUALITY_NOTE_MAX,
  QUALITY_REMINDER_LIST_LIMIT,
  leadQualityMeta,
  qualityNeedsReason,
  type QualityReasonOpt,
  type QualityReminderSnapshot,
} from "./crm-lead-quality";

/** The rating payload every write path accepts (lead PATCH, Enroll, the reminder pop-up). */
export const QualityInputSchema = z.object({
  rating: z.enum(LEAD_QUALITY_RATINGS),
  reasonId: z.string().nullable().optional(),
  note: z.string().trim().max(QUALITY_NOTE_MAX).nullable().optional(),
});
export type QualityInput = z.infer<typeof QualityInputSchema>;

export type QualityChange = {
  data: {
    qualityRating: string;
    qualityReasonId: string | null;
    qualityNote: string | null;
    qualityRatedAt: Date;
    qualityRatedById: string;
  };
  /** Timeline line, e.g. "Quality: Not rated → Junk (Wrong / invalid number)". */
  summary: string;
  metadata: { from: string | null; to: string; reason: string | null; note: string | null };
};

/**
 * Turn a submitted rating into the Lead columns it writes, or null when it
 * changes nothing. Poor / Junk need an ACTIVE reason; Good / Average drop any
 * reason sent, so a lead upgraded from Junk to Good can't keep "Fake" behind it.
 */
export async function resolveQualityChange(
  existing: {
    qualityRating: string | null;
    qualityReasonId: string | null;
    qualityNote: string | null;
  },
  input: QualityInput,
  actorId: string,
  now: Date = new Date(),
): Promise<QualityChange | null> {
  let reasonId: string | null = null;
  let reasonLabel: string | null = null;
  if (qualityNeedsReason(input.rating)) {
    if (!input.reasonId) {
      throw badRequest(`Pick a reason for rating this lead ${leadQualityMeta(input.rating)!.label}.`, "quality_reason_required");
    }
    const reason = await prisma.crmLeadQualityReason.findFirst({
      where: { id: input.reasonId, active: true },
      select: { id: true, label: true },
    });
    if (!reason) throw badRequest("Unknown or inactive quality reason.", "invalid_quality_reason");
    reasonId = reason.id;
    reasonLabel = reason.label;
  }
  const note = input.note?.trim() ? input.note.trim() : null;

  if (
    existing.qualityRating === input.rating &&
    existing.qualityReasonId === reasonId &&
    existing.qualityNote === note
  ) {
    return null;
  }

  const from = leadQualityMeta(existing.qualityRating)?.label ?? "Not rated";
  const to = leadQualityMeta(input.rating)!.label;
  return {
    data: {
      qualityRating: input.rating,
      qualityReasonId: reasonId,
      qualityNote: note,
      qualityRatedAt: now,
      qualityRatedById: actorId,
    },
    summary: `Quality: ${from} → ${to}${reasonLabel ? ` (${reasonLabel})` : ""}`,
    metadata: { from: existing.qualityRating, to: input.rating, reason: reasonLabel, note },
  };
}

/** Unrated leads whose rating has fallen due — owned, and not system-flagged duplicates. */
export function qualityOverdueWhere(now: Date): Prisma.LeadWhereInput {
  return {
    qualityDueAt: { lte: now },
    qualityRating: null,
    assignedToId: { not: null },
    status: { code: { not: "duplicate" } },
  };
}

export async function activeQualityReasons(): Promise<QualityReasonOpt[]> {
  return prisma.crmLeadQualityReason.findMany({
    where: { active: true },
    orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
    select: { id: true, label: true },
  });
}

/** The reminder pop-up's list: this BDE's overdue ratings, longest-overdue first. */
export async function qualityRemindersFor(userId: string, now: Date = new Date()): Promise<QualityReminderSnapshot> {
  const where: Prisma.LeadWhereInput = { ...qualityOverdueWhere(now), assignedToId: userId };
  const [total, rows, reasons] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: { qualityDueAt: "asc" },
      take: QUALITY_REMINDER_LIST_LIMIT,
      select: {
        id: true,
        candidateName: true,
        campaign: true,
        qualityDueAt: true,
        source: { select: { label: true } },
      },
    }),
    activeQualityReasons(),
  ]);
  return {
    total,
    reasons,
    leads: rows.map((l) => ({
      id: l.id,
      candidateName: l.candidateName,
      source: l.source?.label ?? null,
      campaign: l.campaign,
      dueAt: l.qualityDueAt!.toISOString(),
    })),
  };
}
