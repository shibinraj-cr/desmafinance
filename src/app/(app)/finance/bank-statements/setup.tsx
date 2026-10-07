"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Section } from "@/components/Cards";
import { Modal, Notice, api, inputCls, primaryBtn, secondaryBtn } from "./_ui";

type Bank = { code: string; name: string };

function IntegrationForm({ banks, onDone, onCancel }: { banks: Bank[]; onDone: (id: string) => void; onCancel?: () => void }) {
  const [bankCode, setBankCode] = useState(banks[0]?.code ?? "HDFC");
  const [accountName, setAccountName] = useState("");
  const [last4, setLast4] = useState("");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-md"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ id: string }>("/api/finance/bank-accounts", "POST", {
            bankCode,
            accountName,
            accountLastFour: last4,
            emailRecipient: recipient,
          });
          onDone(r.id);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not add the account");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block space-y-xs">
        <span className="text-label-sm font-semibold">Bank</span>
        <select className={inputCls} value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-xs">
        <span className="text-label-sm font-semibold">Account name</span>
        <input className={inputCls} required maxLength={80} value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="e.g. Current account" />
      </label>
      <label className="block space-y-xs">
        <span className="text-label-sm font-semibold">Account number — last four digits</span>
        <input className={inputCls} required inputMode="numeric" pattern="\d{4}" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} />
      </label>
      <label className="block space-y-xs">
        <span className="text-label-sm font-semibold">Mailbox that receives the statement e-mail</span>
        <input className={inputCls} type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="accounts@yourcompany.in" />
        <span className="text-caption text-on-surface-variant">Only this Gmail account will be accepted when connecting.</span>
      </label>
      <p className="text-caption text-on-surface-variant">
        The statement sender and subject are prefilled for the bank and can be reviewed on the Automation tab.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end gap-sm">
        {onCancel && (
          <button type="button" className={secondaryBtn} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className={primaryBtn} disabled={busy || last4.length !== 4 || !accountName}>
          {busy ? "Adding…" : "Add bank account"}
        </button>
      </div>
    </form>
  );
}

export function SetupIntegration({ canManage, banks }: { canManage: boolean; banks: Bank[] }) {
  const router = useRouter();
  if (!canManage) {
    return <Notice>No bank account has been set up for statement automation yet. A Finance administrator can add one here.</Notice>;
  }
  return (
    <Section title="Connect a bank account">
      <p className="text-body-md text-on-surface-variant mb-md">
        DesGro reads the bank&apos;s daily statement e-mail, opens the secure statement link, archives the PDF and imports every
        transaction — once, with duplicates refused at three levels.
      </p>
      <IntegrationForm banks={banks} onDone={(id) => router.push(`/finance/bank-statements?tab=automation&account=${id}`)} />
    </Section>
  );
}

export function AccountPicker({
  accounts,
  current,
  canManage,
  banks,
}: {
  accounts: Array<{ id: string; label: string; name: string }>;
  current: string;
  canManage: boolean;
  banks: Bank[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex items-center gap-sm">
      {accounts.length > 1 && (
        <select
          aria-label="Bank account"
          className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm font-semibold"
          value={current}
          onChange={(e) => {
            const p = new URLSearchParams({ tab: search.get("tab") ?? "consolidated", account: e.target.value });
            router.push(`${pathname}?${p.toString()}`);
          }}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} · {a.name}
            </option>
          ))}
        </select>
      )}
      {canManage && (
        <button type="button" className={secondaryBtn} onClick={() => setAdding(true)}>
          <span className="material-symbols-outlined text-[18px]">add</span>
          <span className="hidden md:inline">Add account</span>
        </button>
      )}
      {adding && (
        <Modal title="Add a bank account" onClose={() => setAdding(false)}>
          <IntegrationForm
            banks={banks}
            onCancel={() => setAdding(false)}
            onDone={(id) => {
              setAdding(false);
              router.push(`${pathname}?tab=automation&account=${id}`);
              router.refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
