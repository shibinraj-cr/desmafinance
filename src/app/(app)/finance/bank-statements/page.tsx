import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { KpiCard } from "@/components/Cards";
import { bankCaps } from "@/lib/bank/access";
import { TRANSACTION_TYPES } from "@/lib/bank/classify";
import { SUPPORTED_BANKS } from "@/lib/bank/parsers";
import { BANK_DEFAULTS } from "@/lib/bank/integration";
import {
  RECON_STATUSES,
  STATEMENT_SELECT,
  listTransactions,
  parseTxnFilters,
  serializeStatement,
} from "@/lib/bank/queries";
import { automationStatus } from "@/lib/bank/status";
import { BankTabs, TABS, type TabKey } from "./_ui";
import { AccountPicker, SetupIntegration } from "./setup";
import { TransactionsView } from "./transactions";
import { StatementsView } from "./statements";
import { AutomationView } from "./automation";
import { AuditView } from "./audit";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default async function BankStatementsPage({ searchParams }: { searchParams: SP }) {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  const caps = bankCaps(perms);
  if (!caps.view) redirect("/finance/overview");

  const integrations = await prisma.bankIntegration.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, bankName: true, accountName: true, accountLastFour: true },
  });
  const banks = SUPPORTED_BANKS.map((code) => ({ code, name: BANK_DEFAULTS[code]?.bankName ?? code }));

  if (integrations.length === 0) {
    return (
      <>
        <TopBar title="Bank Statements" subtitle="Automated statement import & reconciliation" />
        <div className="p-margin space-y-md max-w-2xl">
          <SetupIntegration canManage={caps.manage} banks={banks} />
        </div>
      </>
    );
  }

  const one = (k: string) => (Array.isArray(searchParams[k]) ? searchParams[k]![0] : (searchParams[k] as string | undefined));
  const tabParam = one("tab");
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "transactions";
  const integration = integrations.find((i) => i.id === one("account")) ?? integrations[0];
  const page = Math.max(1, Number(one("page")) || 1);
  const accounts = integrations.map((i) => ({ id: i.id, label: `${i.bankName} ••••${i.accountLastFour}`, name: i.accountName }));

  let body: React.ReactNode = null;

  if (tab === "transactions" || tab === "reconciliation") {
    const filters = parseTxnFilters({ ...searchParams, account: integration.id });
    if (tab === "reconciliation" && filters.recon.length === 0) filters.recon = ["UNMATCHED", "MANUAL_REVIEW", "PARTIALLY_MATCHED"];
    const [list, recon] = await Promise.all([
      listTransactions(filters, page),
      tab === "reconciliation"
        ? prisma.bankTransaction.groupBy({ by: ["reconciliationStatus"], where: { integrationId: integration.id }, _count: true })
        : Promise.resolve([]),
    ]);
    const count = (s: string) => recon.find((r) => r.reconciliationStatus === s)?._count ?? 0;
    body = (
      <>
        {tab === "reconciliation" && (
          <section className="grid grid-cols-2 lg:grid-cols-5 gap-gutter">
            <KpiCard label="Unmatched" value={count("UNMATCHED").toLocaleString("en-IN")} hint="Not yet tied to the ledger" />
            <KpiCard label="Manual review" value={count("MANUAL_REVIEW").toLocaleString("en-IN")} tone={count("MANUAL_REVIEW") ? "danger" : "default"} />
            <KpiCard label="Partially matched" value={count("PARTIALLY_MATCHED").toLocaleString("en-IN")} />
            <KpiCard label="Matched" value={count("MATCHED").toLocaleString("en-IN")} tone="success" />
            <KpiCard label="Ignored" value={count("IGNORED").toLocaleString("en-IN")} />
          </section>
        )}
        <TransactionsView
          tab={tab}
          rows={list.rows}
          total={list.total}
          page={page}
          totalDebit={list.totalDebit}
          totalCredit={list.totalCredit}
          types={[...TRANSACTION_TYPES]}
          reconStatuses={[...RECON_STATUSES]}
          canReconcile={caps.reconcile}
        />
      </>
    );
  } else if (tab === "statements") {
    const where = { integrationId: integration.id };
    const [rows, total] = await Promise.all([
      prisma.bankStatement.findMany({
        where,
        select: STATEMENT_SELECT,
        orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * 50,
        take: 50,
      }),
      prisma.bankStatement.count({ where }),
    ]);
    body = (
      <StatementsView
        integrationId={integration.id}
        rows={rows.map(serializeStatement)}
        total={total}
        page={page}
        canManage={caps.manage}
        canDownload={caps.download}
      />
    );
  } else if (tab === "automation") {
    body = <AutomationView initial={await automationStatus(integration.id)} canManage={caps.manage} />;
  } else {
    const [runs, events] = await Promise.all([
      prisma.bankStatementRun.findMany({
        where: { integrationId: integration.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          trigger: true,
          status: true,
          phase: true,
          fromDate: true,
          toDate: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          gmailMessagesFound: true,
          statementsProcessed: true,
          statementsFailed: true,
          transactionsCreated: true,
          transactionsSkipped: true,
          transactionsFailed: true,
          errorSummary: true,
          initiatedById: true,
        },
      }),
      prisma.bankAutomationEvent.findMany({
        where: { integrationId: integration.id, runId: null },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, level: true, step: true, message: true, createdAt: true, userId: true },
      }),
    ]);
    const userIds = Array.from(new Set([...runs.map((r) => r.initiatedById), ...events.map((e) => e.userId)].filter((x): x is string => !!x)));
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } });
    const name = (id: string | null) => (id ? (users.find((u) => u.id === id)?.username ?? "user") : null);
    body = (
      <AuditView
        runs={runs.map((r) => ({
          ...r,
          fromDate: r.fromDate?.toISOString().slice(0, 10) ?? null,
          toDate: r.toDate?.toISOString().slice(0, 10) ?? null,
          createdAt: r.createdAt.toISOString(),
          startedAt: r.startedAt?.toISOString() ?? null,
          completedAt: r.completedAt?.toISOString() ?? null,
          initiatedBy: name(r.initiatedById),
        }))}
        events={events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString(), user: name(e.userId) }))}
      />
    );
  }

  return (
    <>
      <TopBar
        title="Bank Statements"
        subtitle={`${integration.bankName} ••••${integration.accountLastFour} · ${integration.accountName}`}
        action={<AccountPicker accounts={accounts} current={integration.id} canManage={caps.manage} banks={banks} />}
      />
      <div className="p-margin space-y-lg">
        <BankTabs active={tab} />
        {body}
      </div>
    </>
  );
}
