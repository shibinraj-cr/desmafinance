"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AUD, INR, Icon, fmtDate, useToast } from "@/components/partner-commissions/ui";
import { commissionOf } from "@/lib/partner-commissions/logic";
import { approvedAud, setupGaps, stateOf, totalOf, type PcPageData } from "./_types";
import { EnrollmentsTab } from "./_enrollments";
import { InvoicesTab } from "./_invoices";
import { PaymentsTab } from "./_payments";
import { SettingsTab } from "./_settings";

export type { PcPageData };

type Tab = "enrollments" | "invoices" | "payments" | "settings";

export type PcCtx = {
  data: PcPageData;
  /** Re-fetch server data after a write and say what happened. */
  done: (msg: string) => void;
  toast: (msg: string) => void;
  go: (tab: Tab, invoiceId?: string | null) => void;
};

export function PartnerCommissionsClient({ data, initialTab, initialInvoice, page }: { data: PcPageData; initialTab: string; initialInvoice: string | null; page: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { show, node } = useToast();
  const [tab, setTab] = useState<Tab>(initialTab as Tab);
  const [invoiceId, setInvoiceId] = useState<string | null>(initialInvoice);

  // Keep the tab and open invoice in the URL so a link (or the 20th's alert) lands on them.
  useEffect(() => {
    const q = new URLSearchParams();
    if (tab !== "enrollments") q.set("tab", tab);
    if (tab === "invoices" && invoiceId) q.set("invoice", invoiceId);
    const next = `${pathname}${q.toString() ? `?${q}` : ""}`;
    window.history.replaceState(null, "", next);
  }, [tab, invoiceId, pathname]);

  const go = useCallback((t: Tab, inv: string | null = null) => {
    setTab(t);
    setInvoiceId(t === "invoices" ? inv : null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const done = useCallback(
    (msg: string) => {
      show(msg);
      router.refresh();
    },
    [router, show],
  );
  const ctx: PcCtx = { data, done, toast: show, go };

  const k = useMemo(() => {
    const live = data.enrollments.filter((e) => e.status !== "withdrawn");
    const paying = live.filter((e) => ["paying", "notstarted"].includes(stateOf(e)));
    const queued = live.filter((e) => stateOf(e) === "fullypaid");
    const open = data.invoices.filter((i) => ["draft", "sent", "partpaid", "awaiting"].includes(i.status));
    const receipts = data.invoices.flatMap((i) => i.receipts);
    const fyStart = `${Number(data.today.slice(0, 4)) - (Number(data.today.slice(5, 7)) < 4 ? 1 : 0)}-04-01`;
    const received = receipts.filter((r) => r.status === "approved" && r.receivedOn >= fyStart);
    return {
      paying: paying.length,
      payingAud: paying.reduce((s, e) => s + e.balance, 0),
      queued: queued.length,
      queuedAud: queued.reduce((s, e) => s + commissionOf(e.courseFee, e.commissionPct), 0),
      openAud: open.reduce((s, i) => s + Math.max(0, totalOf(i) - approvedAud(i)), 0),
      drafts: data.invoices.filter((i) => i.status === "draft").length,
      awaiting: receipts.filter((r) => r.status === "awaiting").length,
      fyInr: received.reduce((s, r) => s + r.inrAmount, 0),
      fyAud: received.reduce((s, r) => s + r.audSettled, 0),
      fyLabel: `${fyStart.slice(2, 4)}-${String(Number(fyStart.slice(0, 4)) + 1).slice(2)}`,
    };
  }, [data]);

  const gaps = setupGaps(data.settings, data.partners, data.programs);
  const tabs: Array<[Tab, string, number, boolean]> = [
    ["enrollments", "Enrollments", data.enrollments.length, false],
    ["invoices", "Invoices", k.drafts, k.drafts > 0],
    ["payments", "Payments & approval", k.awaiting, k.awaiting > 0],
    ["settings", "Settings", 0, false],
  ];

  const s = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  return (
    <div className="p-md md:p-margin flex flex-col gap-lg" data-page={page}>
      {gaps.length ? (
        <div className="flex gap-2.5 items-start px-sm py-2.5 rounded-lg border border-primary-container bg-primary-fixed/40 text-body-md">
          <Icon name="settings" className="mt-0.5" />
          <div>
            <b>Finish setting up before the first invoice:</b> {gaps.join(", ")}.{" "}
            {data.canApprove ? (
              <button className="text-accent font-semibold underline underline-offset-2" onClick={() => go("settings")}>Open Settings</button>
            ) : (
              "A Finance Manager does this on the Settings tab."
            )}
          </div>
        </div>
      ) : null}

      <section className="grid gap-md grid-cols-[repeat(auto-fit,minmax(210px,1fr))]" aria-label="Summary">
        <Kpi icon="hourglass_top" label="Still paying fees" value={AUD(k.payingAud)} sub={`${s(k.paying, "candidate")} · balance owed to institutions`} />
        <Kpi icon="event_upcoming" label={`Queued for ${fmtDate(data.run.nextRun).replace(/ \d{4}$/, "")} run`} value={AUD(k.queuedAud)} sub={k.queued ? s(k.queued, "fully paid enrollment") : "No fully paid enrollments waiting"} attn={k.queued > 0} />
        <Kpi icon="description" label="Invoiced, not yet paid" value={AUD(k.openAud)} sub={`${s(k.drafts, "draft")} to send · ${k.awaiting} awaiting approval`} attn={k.drafts > 0 || k.awaiting > 0} />
        <Kpi icon="trending_up" label={`Commission received, FY ${k.fyLabel}`} value={INR(k.fyInr)} sub={`${AUD(k.fyAud)} · posted to Revenue › Commissions`} />
      </section>

      <div className="flex gap-1 border-b border-outline-variant overflow-x-auto" role="tablist" aria-label="Sections">
        {tabs.map(([key, label, count, hot]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => go(key)}
            className={`px-md py-2.5 -mb-px border-b-[3px] text-body-md font-semibold whitespace-nowrap inline-flex items-center gap-2 ${tab === key ? "border-primary text-on-surface" : "border-transparent text-on-surface-variant hover:text-on-surface"}`}
          >
            {label}
            {count ? <span className={`text-[11px] px-2 rounded-full ${hot ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant"}`}>{count}</span> : null}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "enrollments" ? <EnrollmentsTab ctx={ctx} /> : null}
        {tab === "invoices" ? <InvoicesTab ctx={ctx} invoiceId={invoiceId} /> : null}
        {tab === "payments" ? <PaymentsTab ctx={ctx} /> : null}
        {tab === "settings" ? <SettingsTab ctx={ctx} /> : null}
      </div>
      {node}
    </div>
  );
}

function Kpi({ icon, label, value, sub, attn }: { icon: string; label: string; value: string; sub: string; attn?: boolean }) {
  return (
    <div className={`bg-surface-container-lowest border rounded-xl px-md py-sm flex flex-col gap-1 min-w-0 ${attn ? "border-primary-container shadow-[inset_3px_0_0_theme(colors.primary)]" : "border-outline-variant"}`}>
      <span className="text-label-sm text-on-surface-variant flex items-center gap-1.5"><Icon name={icon} />{label}</span>
      <b className="text-h3 tabular-nums">{value}</b>
      <span className="text-caption text-on-surface-variant">{sub}</span>
    </div>
  );
}
