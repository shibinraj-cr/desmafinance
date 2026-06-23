import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Process template (+ ordered steps + project count) — the include used by the
 * Operations templates page and API. Mirrors the `Prisma.validator` include
 * pattern used across `src/lib/crm-leads.ts`.
 */
export const opsTemplateInclude = Prisma.validator<Prisma.ProcessTemplateInclude>()({
  service: { select: { id: true, name: true, isActive: true } },
  steps: { orderBy: { seq: "asc" } },
  _count: { select: { projects: true } },
});

export type TemplateStepDTO = {
  id: string;
  seq: number;
  name: string;
  description: string | null;
  phase: string | null;
  isRequired: boolean;
  slaDays: number | null;
};

export type TemplateDTO = {
  id: string;
  serviceId: string;
  serviceName: string;
  name: string;
  description: string | null;
  isActive: boolean;
  version: number;
  isSystem: boolean;
  projectCount: number;
  createdAt: string;
  steps: TemplateStepDTO[];
};

type TemplateWithInclude = Prisma.ProcessTemplateGetPayload<{ include: typeof opsTemplateInclude }>;

/** ISO-serialize a template (+ steps) for the client. */
export function serializeTemplate(t: TemplateWithInclude): TemplateDTO {
  return {
    id: t.id,
    serviceId: t.serviceId,
    serviceName: t.service.name,
    name: t.name,
    description: t.description,
    isActive: t.isActive,
    version: t.version,
    isSystem: t.isSystem,
    projectCount: t._count.projects,
    createdAt: t.createdAt.toISOString(),
    steps: t.steps.map((s) => ({
      id: s.id,
      seq: s.seq,
      name: s.name,
      description: s.description,
      phase: s.phase,
      isRequired: s.isRequired,
      slaDays: s.slaDays,
    })),
  };
}

/**
 * The single active template for a service (highest version wins as a tiebreak,
 * though only one should be active). Returned with steps ordered by seq.
 * Reused by the CRM-enroll hook in Phase 2 to instantiate a project's tasks.
 */
export async function getActiveTemplateForService(
  client: PrismaClient | Prisma.TransactionClient,
  serviceId: string,
) {
  return client.processTemplate.findFirst({
    where: { serviceId, isActive: true },
    orderBy: { version: "desc" },
    include: { steps: { orderBy: { seq: "asc" } } },
  });
}

/** List every template (across services) for the admin templates page. */
export async function listTemplates(): Promise<TemplateDTO[]> {
  const rows = await prisma.processTemplate.findMany({
    include: opsTemplateInclude,
    orderBy: [{ service: { name: "asc" } }, { version: "desc" }],
  });
  return rows.map(serializeTemplate);
}
