import { Prisma } from "@prisma/client";
import { fromPrismaDate, istDateString } from "./lead-pulse-dates";
import { opsActionItemInclude, serializeActionItem, type OpsActionItemDTO } from "./ops-action-items";
import type { ProofFact } from "./ops-doc-ai";

/**
 * Read-side helpers for the Operations workspace: Prisma includes, filter
 * builders, and DTO serializers (ISO dates) for the projects list, the
 * candidate-project detail, and the "My Work" queue. Mirrors the
 * include/serialize/where pattern in `src/lib/crm-leads.ts`.
 */

const OPEN_STATUSES = ["pending", "in_progress", "blocked"];

export const opsProjectListInclude = Prisma.validator<Prisma.OpsProjectInclude>()({
  party: { select: { name: true } },
  service: { select: { name: true } },
  assignedTo: { select: { id: true, username: true } },
  template: { select: { name: true, version: true } },
  tasks: { select: { status: true, isRequired: true, dueAt: true } },
});

export const opsProjectDetailInclude = Prisma.validator<Prisma.OpsProjectInclude>()({
  party: { select: { id: true, name: true, email: true, phone: true } },
  service: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, username: true } },
  template: { select: { id: true, name: true, version: true } },
  lead: { select: { id: true, candidateName: true } },
  tasks: {
    orderBy: { seq: "asc" },
    include: {
      assignedTo: { select: { id: true, username: true } },
      completedBy: { select: { id: true, username: true } },
      actionItems: { orderBy: { createdAt: "asc" }, include: opsActionItemInclude },
      documents: {
        orderBy: { createdAt: "desc" },
        include: { uploadedBy: { select: { username: true } } },
      },
    },
  },
  activities: {
    orderBy: { occurredAt: "desc" },
    take: 100,
    include: { actor: { select: { id: true, username: true } } },
  },
});

type ListPayload = Prisma.OpsProjectGetPayload<{ include: typeof opsProjectListInclude }>;
type DetailPayload = Prisma.OpsProjectGetPayload<{ include: typeof opsProjectDetailInclude }>;

export type OpsProjectRow = {
  id: string;
  candidateName: string;
  serviceName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  status: string;
  templateName: string | null;
  templateVersion: number | null;
  startedAt: string;
  dueAt: string | null;
  lastActivityAt: string;
  taskTotal: number;
  taskDone: number;
  taskOpen: number;
  overdueCount: number;
};

/** Count open tasks whose due date is strictly before today (IST). */
function overdue(tasks: { status: string; dueAt: Date | null }[], today: string): number {
  return tasks.filter((t) => OPEN_STATUSES.includes(t.status) && t.dueAt && fromPrismaDate(t.dueAt) < today).length;
}

export function serializeProjectRow(p: ListPayload, today: string = istDateString()): OpsProjectRow {
  const done = p.tasks.filter((t) => t.status === "completed" || t.status === "skipped").length;
  const open = p.tasks.filter((t) => OPEN_STATUSES.includes(t.status)).length;
  return {
    id: p.id,
    candidateName: p.party.name,
    serviceName: p.service.name,
    assigneeId: p.assignedTo?.id ?? null,
    assigneeName: p.assignedTo?.username ?? null,
    status: p.status,
    templateName: p.template?.name ?? null,
    templateVersion: p.template?.version ?? null,
    startedAt: p.startedAt.toISOString(),
    dueAt: p.dueAt ? p.dueAt.toISOString() : null,
    lastActivityAt: p.lastActivityAt.toISOString(),
    taskTotal: p.tasks.length,
    taskDone: done,
    taskOpen: open,
    overdueCount: overdue(p.tasks, today),
  };
}

export type OpsTaskDTO = {
  id: string;
  seq: number;
  name: string;
  description: string | null;
  phase: string | null;
  isRequired: boolean;
  status: string;
  slaDays: number | null;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  assigneeName: string | null;
  /** Username of who marked the step done (survives project re-assignment). */
  completedByName: string | null;
  blockedReason: string | null;
  notes: string | null;
  /** Ad-hoc tasks attached to this step. */
  actionItems: OpsActionItemDTO[];
  /** Proof-of-completion files attached to this step. */
  documents: OpsDocumentDTO[];
};

export type OpsDocumentDTO = {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedByName: string | null;
  createdAt: string;
  /** 'pending' | 'processing' | 'done' | 'failed' | 'skipped' */
  aiStatus: string;
  aiVerdict: string | null;
  aiSummary: string | null;
  aiConcerns: string | null;
  aiFacts: ProofFact[];
  aiAnalyzedAt: string | null;
};

export type OpsActivityDTO = {
  id: string;
  type: string;
  summary: string | null;
  actorName: string | null;
  occurredAt: string;
};

export type OpsProjectDetailDTO = OpsProjectRow & {
  partyId: string;
  serviceId: string;
  leadId: string | null;
  candidateEmail: string | null;
  candidatePhone: string | null;
  tasks: OpsTaskDTO[];
  activities: OpsActivityDTO[];
};

export function serializeProjectDetail(p: DetailPayload, today: string = istDateString()): OpsProjectDetailDTO {
  return {
    ...serializeProjectRow(p as unknown as ListPayload, today),
    partyId: p.party.id,
    serviceId: p.service.id,
    leadId: p.lead?.id ?? null,
    candidateEmail: p.party.email,
    candidatePhone: p.party.phone,
    tasks: p.tasks.map((t) => ({
      id: t.id,
      seq: t.seq,
      name: t.name,
      description: t.description,
      phase: t.phase,
      isRequired: t.isRequired,
      status: t.status,
      slaDays: t.slaDays,
      dueAt: t.dueAt ? t.dueAt.toISOString() : null,
      startedAt: t.startedAt ? t.startedAt.toISOString() : null,
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      assigneeName: t.assignedTo?.username ?? null,
      completedByName: t.completedBy?.username ?? null,
      blockedReason: t.blockedReason,
      notes: t.notes,
      actionItems: t.actionItems.map(serializeActionItem),
      documents: t.documents.map(serializeDocument),
    })),
    activities: p.activities.map((a) => ({
      id: a.id,
      type: a.type,
      summary: a.summary,
      actorName: a.actor?.username ?? null,
      occurredAt: a.occurredAt.toISOString(),
    })),
  };
}

type DocumentPayload = Prisma.OpsDocumentGetPayload<{ include: { uploadedBy: { select: { username: true } } } }>;

export function serializeDocument(d: DocumentPayload): OpsDocumentDTO {
  return {
    id: d.id,
    fileName: d.fileName,
    fileUrl: d.fileUrl,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    uploadedByName: d.uploadedBy?.username ?? null,
    createdAt: d.createdAt.toISOString(),
    aiStatus: d.aiStatus,
    aiVerdict: d.aiVerdict,
    aiSummary: d.aiSummary,
    aiConcerns: d.aiConcerns,
    aiFacts: Array.isArray(d.aiFacts) ? (d.aiFacts as unknown as ProofFact[]) : [],
    aiAnalyzedAt: d.aiAnalyzedAt ? d.aiAnalyzedAt.toISOString() : null,
  };
}

export type OpsProjectFilters = {
  status?: string | null;
  serviceId?: string | null;
  /** A specific assignee id, the sentinel "me", or "unassigned". */
  assignee?: string | null;
  currentUserId: string;
};

/** Build the Prisma where-clause for the projects list from query filters. */
export function buildOpsProjectWhere(f: OpsProjectFilters): Prisma.OpsProjectWhereInput {
  const where: Prisma.OpsProjectWhereInput = {};
  if (f.status) where.status = f.status;
  if (f.serviceId) where.serviceId = f.serviceId;
  if (f.assignee === "unassigned") where.assignedToId = null;
  else if (f.assignee === "me") where.assignedToId = f.currentUserId;
  else if (f.assignee) where.assignedToId = f.assignee;
  return where;
}
