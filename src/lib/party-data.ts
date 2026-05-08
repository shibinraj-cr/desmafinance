/**
 * Shared loader for the Parties list pages.
 *
 * Resilience: when the Source/Service/Profile schema (`Party.sourceId`
 * + `PartyService` table) hasn't been pushed to the live DB yet, the
 * `include: { source }` clause throws. We catch that and retry with a
 * narrower include so the page still renders. The "Sync schema"
 * button on /master-data/categories handles the additive DDL once,
 * after which the full payload comes through automatically.
 */
import { prisma } from "./prisma";

type PartyWithSource = {
  id: string;
  name: string;
  group: string;
  txTypes: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  sourceId: string | null;
  source: { id: string; label: string } | null;
  services: { id: string; name: string }[];
  _count: { transactions: number };
};

type ServiceOption = { id: string; name: string };
type SourceOption = { id: string; code: string; label: string; active: boolean };

export async function loadPartiesPayload(): Promise<
  [PartyWithSource[], ServiceOption[], SourceOption[]]
> {
  const services = await prisma.service.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const sources = await prisma.leadPulseSource.findMany({
    orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
    select: { id: true, code: true, label: true, active: true },
  });

  let parties: PartyWithSource[];
  try {
    const rows = await prisma.party.findMany({
      orderBy: [{ group: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { transactions: true } },
        services: { select: { id: true, name: true }, orderBy: { name: "asc" } },
        source: { select: { id: true, label: true } },
      },
    });
    parties = rows;
  } catch (e) {
    console.warn("[parties] schema mismatch, falling back to no-source query:", e);
    const rows = await prisma.party.findMany({
      orderBy: [{ group: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { transactions: true } },
        services: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      },
    });
    parties = rows.map((p) => ({
      ...p,
      sourceId: null,
      source: null,
    }));
  }

  return [parties, services, sources];
}
