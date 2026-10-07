/**
 * A tiny in-memory stand-in for the Prisma client, just enough for the bank
 * automation engine: where-filters (equality, in/notIn/not, lt/lte/gt/gte,
 * OR/AND, null), orderBy, select/include of a few relations, increment, and
 * unique constraints so duplicate inserts behave like Postgres.
 *
 * Not a general Prisma emulator — it exists so the engine's idempotency and
 * failure handling can be tested end to end without a database.
 */
import { Prisma } from "@prisma/client";

type Row = Record<string, unknown> & { id: string };
type Where = Record<string, unknown>;

const UNIQUES: Record<string, string[][]> = {
  bankIntegration: [["bankCode", "accountLastFour"]],
  bankIntegrationSecret: [["integrationId", "kind"]],
  bankMailboxConnection: [["emailAddress"]],
  bankStatement: [["integrationId", "gmailMessageId"], ["integrationId", "fileSha256"]],
  bankTransaction: [["integrationId", "transactionHash"]],
  bankTransactionMatch: [["bankTransactionId", "transactionId"]],
};

// relation name → [model, local key, foreign key, many?]
const RELATIONS: Record<string, Record<string, [string, string, string, boolean]>> = {
  bankIntegration: { mailbox: ["bankMailboxConnection", "mailboxConnectionId", "id", false] },
  bankStatement: { run: ["bankStatementRun", "runId", "id", false], integration: ["bankIntegration", "integrationId", "id", false] },
  bankStatementRun: {
    statements: ["bankStatement", "id", "runId", true],
    events: ["bankAutomationEvent", "id", "runId", true],
  },
  user: { roleRef: ["role", "roleId", "id", false] },
};

const DEFAULTS: Record<string, () => Record<string, unknown>> = {
  bankStatementRun: () => ({ status: "QUEUED", gmailMessagesFound: 0, statementsProcessed: 0, statementsFailed: 0, transactionsCreated: 0, transactionsSkipped: 0, transactionsFailed: 0, lockedUntil: null, discoveredAt: null, startedAt: null, completedAt: null, fromDate: null, toDate: null, testResult: null }),
  bankStatement: () => ({ status: "NEW", attempts: 0, nextAttemptAt: null, lockedUntil: null, blobPathname: null, fileSha256: null, attachmentId: null, statementUrlEnc: null, gmailMessageId: null, periodStart: null, periodEnd: null, reviewPayload: null, runId: null, gmailReceivedAt: null, sourceSubject: null }),
  bankTransaction: () => ({ reconciliationStatus: "UNMATCHED" }),
};

let seq = 0;

function cmp(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av === bv) return 0;
  if (av === null || av === undefined) return -1;
  if (bv === null || bv === undefined) return 1;
  return (av as number) < (bv as number) ? -1 : 1;
}
function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

export function createFakePrisma() {
  const tables: Record<string, Row[]> = {};
  const t = (m: string) => (tables[m] ??= []);

  function matches(model: string, row: Row, where: Where | undefined): boolean {
    if (!where) return true;
    for (const [k, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (k === "OR") {
        if (!(cond as Where[]).some((w) => matches(model, row, w))) return false;
        continue;
      }
      if (k === "AND") {
        if (!(cond as Where[]).every((w) => matches(model, row, w))) return false;
        continue;
      }
      // Compound unique selector, e.g. integrationId_gmailMessageId.
      if (cond && typeof cond === "object" && !(cond instanceof Date) && k.includes("_") && !(k in row)) {
        if (!Object.entries(cond as Where).every(([kk, vv]) => eq(row[kk], vv))) return false;
        continue;
      }
      const rel = RELATIONS[model]?.[k];
      if (rel && cond && typeof cond === "object") {
        const [rm, lk, fk] = rel;
        const target = t(rm).find((r) => eq(r[fk], row[lk]));
        if (!target || !matches(rm, target, cond as Where)) return false;
        continue;
      }
      const v = row[k];
      if (cond === null || typeof cond !== "object" || cond instanceof Date) {
        if (!eq(v, cond)) return false;
        continue;
      }
      const c = cond as Record<string, unknown>;
      if ("in" in c && !(c.in as unknown[]).some((x) => eq(v, x))) return false;
      if ("notIn" in c && (c.notIn as unknown[]).some((x) => eq(v, x))) return false;
      if ("not" in c && eq(v, c.not)) return false;
      if ("lt" in c && !(v !== null && v !== undefined && cmp(v, c.lt) < 0)) return false;
      if ("lte" in c && !(v !== null && v !== undefined && cmp(v, c.lte) <= 0)) return false;
      if ("gt" in c && !(v !== null && v !== undefined && cmp(v, c.gt) > 0)) return false;
      if ("gte" in c && !(v !== null && v !== undefined && cmp(v, c.gte) >= 0)) return false;
      if ("equals" in c && !eq(v, c.equals)) return false;
      if ("contains" in c && !String(v ?? "").toLowerCase().includes(String(c.contains).toLowerCase())) return false;
    }
    return true;
  }

  function project(model: string, row: Row, args: { select?: Where; include?: Where } = {}): Row {
    const out: Row = { ...row };
    const rels = { ...(args.include ?? {}), ...(args.select ?? {}) };
    for (const [k, spec] of Object.entries(rels)) {
      const rel = RELATIONS[model]?.[k];
      if (!rel || !spec) continue;
      const [rm, lk, fk, many] = rel;
      const sub = typeof spec === "object" ? (spec as { where?: Where }) : {};
      if (many) out[k] = t(rm).filter((r) => eq(r[fk], row[lk]) && matches(rm, r, sub.where)).map((r) => ({ ...r }));
      else {
        const hit = t(rm).find((r) => eq(r[fk], row[lk]));
        out[k] = hit ? { ...hit } : null;
      }
    }
    return out;
  }

  function sort(rows: Row[], orderBy: unknown): Row[] {
    const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Array<Record<string, "asc" | "desc">>;
    return [...rows].sort((a, b) => {
      for (const o of keys) {
        const [k, dir] = Object.entries(o)[0];
        const c = cmp(a[k], b[k]);
        if (c) return dir === "desc" ? -c : c;
      }
      return 0;
    });
  }

  function violates(model: string, row: Row, ignoreId?: string): boolean {
    for (const keys of UNIQUES[model] ?? []) {
      if (keys.some((k) => row[k] === null || row[k] === undefined)) continue;
      if (t(model).some((r) => r.id !== ignoreId && keys.every((k) => eq(r[k], row[k])))) return true;
    }
    return false;
  }
  const p2002 = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "fake" });

  function applyData(row: Row, data: Record<string, unknown>) {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && !(v instanceof Date) && "increment" in (v as object)) {
        row[k] = ((row[k] as number) ?? 0) + (v as { increment: number }).increment;
      } else if (v !== undefined) row[k] = v;
    }
    row.updatedAt = new Date();
  }

  function model(name: string) {
    return {
      findUnique: async (a: { where: Where; select?: Where; include?: Where }) => {
        const r = t(name).find((x) => matches(name, x, a.where));
        return r ? project(name, r, a) : null;
      },
      findUniqueOrThrow: async (a: { where: Where; select?: Where; include?: Where }) => {
        const r = t(name).find((x) => matches(name, x, a.where));
        if (!r) throw new Error(`${name} not found`);
        return project(name, r, a);
      },
      findFirst: async (a: { where?: Where; orderBy?: unknown; select?: Where; include?: Where } = {}) => {
        const r = sort(t(name).filter((x) => matches(name, x, a.where)), a.orderBy)[0];
        return r ? project(name, r, a) : null;
      },
      findMany: async (a: { where?: Where; orderBy?: unknown; take?: number; skip?: number; select?: Where; include?: Where } = {}) =>
        sort(t(name).filter((x) => matches(name, x, a.where)), a.orderBy)
          .slice(a.skip ?? 0, a.take ? (a.skip ?? 0) + a.take : undefined)
          .map((r) => project(name, r, a)),
      count: async (a: { where?: Where } = {}) => t(name).filter((x) => matches(name, x, a.where)).length,
      create: async (a: { data: Record<string, unknown> }) => {
        const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...(DEFAULTS[name]?.() ?? {}), ...a.data } as Row;
        if (violates(name, row)) throw p2002();
        t(name).push(row);
        return { ...row };
      },
      createMany: async (a: { data: Array<Record<string, unknown>>; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const d of a.data) {
          const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...(DEFAULTS[name]?.() ?? {}), ...d } as Row;
          if (violates(name, row)) {
            if (a.skipDuplicates) continue;
            throw p2002();
          }
          t(name).push(row);
          count++;
        }
        return { count };
      },
      update: async (a: { where: Where; data: Record<string, unknown> }) => {
        const r = t(name).find((x) => matches(name, x, a.where));
        if (!r) throw new Error(`${name} not found for update`);
        const next = { ...r };
        applyData(next, a.data);
        if (violates(name, next, r.id)) throw p2002();
        Object.assign(r, next);
        return { ...r };
      },
      updateMany: async (a: { where: Where; data: Record<string, unknown> }) => {
        const rows = t(name).filter((x) => matches(name, x, a.where));
        rows.forEach((r) => applyData(r, a.data));
        return { count: rows.length };
      },
      upsert: async (a: { where: Where; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const r = t(name).find((x) => matches(name, x, a.where));
        if (r) {
          applyData(r, a.update);
          return { ...r };
        }
        return model(name).create({ data: a.create });
      },
      deleteMany: async (a: { where?: Where } = {}) => {
        const keep = t(name).filter((x) => !matches(name, x, a.where));
        const n = t(name).length - keep.length;
        tables[name] = keep;
        return { count: n };
      },
    };
  }

  const client = new Proxy(
    {
      $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
      _tables: tables,
    } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        return (target[prop] = model(prop));
      },
    },
  );
  return client as unknown as Record<string, ReturnType<typeof model>> & { _tables: Record<string, Row[]> };
}
