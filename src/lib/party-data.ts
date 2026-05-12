/**
 * Shared loader for the Parties list pages.
 *
 * Resilience: when the Source/Service/Profile schema (`Party.sourceId`
 * + `PartyService` table) hasn't been pushed to the live DB yet,
 * Prisma's default `findMany` builds SQL that SELECTs `Party."sourceId"`
 * explicitly (because the schema says it exists), which Postgres
 * rejects with `column "sourceId" does not exist`. The try/catch
 * catches that and retries with an explicit `select` list that omits
 * the new column. The "Sync schema" button on /master-data/categories
 * closes the gap permanently.
 */
import { prisma } from "./prisma";

type PartyForList = {
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
  [PartyForList[], ServiceOption[], SourceOption[]]
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

  let parties: PartyForList[];
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
    // Use an explicit `select` to avoid Prisma SELECTing the missing
    // `sourceId` column. List only the fields we need + the legacy
    // services M:M.
    const rows = await prisma.party.findMany({
      orderBy: [{ group: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        group: true,
        txTypes: true,
        email: true,
        phone: true,
        notes: true,
        isActive: true,
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

/**
 * Detail-page loader — same resilience pattern as the list loader.
 * Returns null if the party doesn't exist.
 */
export type PartyDetailLoaded = {
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
  assignedL2BdeId: string | null;
  assignedL2Bde: { id: string; username: string } | null;
  partyServices: Array<{
    id: string;
    serviceId: string;
    totalAmount: { toString: () => string };
    notes: string | null;
    service: { id: string; name: string; isActive: boolean };
  }>;
};

export async function loadPartyDetail(id: string): Promise<PartyDetailLoaded | null> {
  try {
    const p = (await prisma.party.findUnique({
      where: { id },
      include: {
        source: { select: { id: true, label: true } },
        assignedL2Bde: { select: { id: true, username: true } },
        partyServices: {
          orderBy: { createdAt: "asc" },
          include: { service: { select: { id: true, name: true, isActive: true } } },
        },
      },
    })) as PartyDetailLoaded | null;
    return p;
  } catch (e) {
    console.warn("[party-detail] schema mismatch, falling back:", e);
    const fallback = await prisma.party.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        group: true,
        txTypes: true,
        email: true,
        phone: true,
        notes: true,
        isActive: true,
      },
    });
    if (!fallback) return null;
    return {
      ...fallback,
      sourceId: null,
      source: null,
      assignedL2BdeId: null,
      assignedL2Bde: null,
      partyServices: [],
    };
  }
}
