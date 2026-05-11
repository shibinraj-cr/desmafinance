"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Source = { id: string; code: string; label: string; displayOrder: number; active: boolean };
type Region = { id: string; code: string; label: string; active: boolean };
type LockedEntry = {
  id: string;
  userId: string;
  username: string;
  sourceLabel: string;
  entryDate: string;
  submittedAt: string | null;
  roleAtEntry: string;
};

type AuditEvent = {
  id: string;
  eventType: string;
  occurredAt: string;
  actorUsername: string | null;
  metadata: Record<string, unknown> | null;
};

type TabKey = "sources" | "regions" | "lock-override" | "audit";

export function SettingsTabs({
  initialTab,
  sources,
  regions,
  lockedEntries,
  auditEvents,
}: {
  initialTab: TabKey;
  sources: Source[];
  regions: Region[];
  lockedEntries: LockedEntry[];
  auditEvents: AuditEvent[];
}) {
  const [tab, setTab] = useState<TabKey>(initialTab);

  const tabs: [TabKey, string][] = [
    ["sources", "Lead Sources"],
    ["regions", "Regions"],
    ["lock-override", "Lock Override"],
    ["audit", "Audit Log"],
  ];

  return (
    <div className="space-y-[16px]">
      <div className="flex items-center gap-[4px] border-b" style={{ borderColor: "var(--lp-outline-variant)" }}>
        {tabs.map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="h-[40px] px-[16px] text-[13px] font-semibold transition border-b-2"
            style={{
              color: tab === t ? "var(--lp-primary)" : "var(--lp-on-surface-variant)",
              borderColor: tab === t ? "var(--lp-primary)" : "transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "sources" && <SourcesTab sources={sources} />}
      {tab === "regions" && <RegionsTab regions={regions} />}
      {tab === "lock-override" && <LockOverrideTab entries={lockedEntries} />}
      {tab === "audit" && <AuditTab events={auditEvents} />}
    </div>
  );
}

function AuditTab({ events }: { events: AuditEvent[] }) {
  return (
    <div className="space-y-[12px]">
      <div
        className="rounded-[12px] border overflow-hidden"
        style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
      >
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
              <Th>When</Th>
              <Th>Actor</Th>
              <Th>Event</Th>
              <Th>Detail</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
                <td className="px-[16px] py-[8px] tabular-nums" style={{ color: "var(--lp-on-surface-variant)" }}>
                  {new Date(e.occurredAt).toLocaleString()}
                </td>
                <td className="px-[16px] py-[8px]">{e.actorUsername ?? "—"}</td>
                <td className="px-[16px] py-[8px]">
                  <span
                    className="text-[11px] px-[8px] py-[2px] rounded-full font-semibold uppercase"
                    style={{ backgroundColor: "var(--lp-surface-container-high)", color: "var(--lp-primary)" }}
                  >
                    {e.eventType}
                  </span>
                </td>
                <td className="px-[16px] py-[8px] text-[12px] font-mono" style={{ color: "var(--lp-on-surface-variant)" }}>
                  {e.metadata ? truncate(JSON.stringify(e.metadata), 90) : ""}
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={4} className="px-[16px] py-[16px] text-center" style={{ color: "var(--lp-on-surface-variant)" }}>
                  No audit events yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function SourcesTab({ sources }: { sources: Source[] }) {
  return (
    <div className="space-y-[12px]">
      <Banner>Disabling a source hides it from new daily entry forms but preserves historical data.</Banner>
      <div className="flex justify-end">
        <NewSourceButton />
      </div>
      <div
        className="rounded-[12px] border overflow-hidden"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        <table className="w-full text-[14px]">
          <thead>
            <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
              <Th>Code</Th>
              <Th>Label</Th>
              <Th className="text-right">Display order</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <SourceRow key={s.id} source={s} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourceRow({ source }: { source: Source }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ label: source.label, displayOrder: source.displayOrder });

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/marketing/lead-pulse/sources/${source.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: draft.label, displayOrder: draft.displayOrder }),
    });
    setBusy(false);
    if (!res.ok) {
      alert("Failed to save.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function toggleActive() {
    setBusy(true);
    await fetch(`/api/marketing/lead-pulse/sources/${source.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !source.active }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <tr className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
      <td className="px-[16px] py-[10px] font-mono text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        {source.code}
      </td>
      <td className="px-[16px] py-[10px]">
        {editing ? (
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            className="w-full h-[32px] px-[8px] rounded"
          />
        ) : (
          source.label
        )}
      </td>
      <td className="px-[16px] py-[10px] text-right">
        {editing ? (
          <input
            type="number"
            value={draft.displayOrder}
            onChange={(e) => setDraft({ ...draft, displayOrder: Number(e.target.value) || 0 })}
            className="w-[80px] h-[32px] px-[8px] rounded text-right"
          />
        ) : (
          source.displayOrder
        )}
      </td>
      <td className="px-[16px] py-[10px]">
        <span
          className="inline-flex items-center px-[10px] py-[3px] rounded-full text-[11px] font-bold"
          style={
            source.active
              ? { backgroundColor: "rgba(51,228,255,0.15)", color: "#33e4ff" }
              : { backgroundColor: "var(--lp-surface-container-high)", color: "var(--lp-on-surface-variant)" }
          }
        >
          {source.active ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="px-[16px] py-[10px] text-right whitespace-nowrap">
        {editing ? (
          <span className="inline-flex items-center gap-[4px]">
            <button
              onClick={save}
              disabled={busy}
              className="h-[28px] px-[12px] rounded text-[12px] font-semibold"
              style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
            >
              {busy ? "…" : "Save"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setDraft({ label: source.label, displayOrder: source.displayOrder });
              }}
              className="h-[28px] px-[12px] rounded border text-[12px]"
              style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)" }}
            >
              Cancel
            </button>
          </span>
        ) : (
          <span className="inline-flex items-center gap-[4px]">
            <IconBtn icon={source.active ? "toggle_on" : "toggle_off"} onClick={toggleActive} disabled={busy} />
            <IconBtn icon="edit" onClick={() => setEditing(true)} />
          </span>
        )}
      </td>
    </tr>
  );
}

function RegionsTab({ regions }: { regions: Region[] }) {
  return (
    <div className="space-y-[12px]">
      <Banner>Regions are used to filter monthly reports and to focus a BDE&apos;s territory.</Banner>
      <div className="flex justify-end">
        <NewRegionButton />
      </div>
      <div
        className="rounded-[12px] border overflow-hidden"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        <table className="w-full text-[14px]">
          <thead>
            <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
              <Th>Code</Th>
              <Th>Label</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {regions.map((r) => (
              <RegionRow key={r.id} region={r} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RegionRow({ region }: { region: Region }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState(region.label);

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/marketing/lead-pulse/regions/${region.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    });
    setBusy(false);
    if (!res.ok) {
      alert("Failed to save.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function toggleActive() {
    setBusy(true);
    await fetch(`/api/marketing/lead-pulse/regions/${region.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !region.active }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <tr className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
      <td className="px-[16px] py-[10px] font-mono text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        {region.code}
      </td>
      <td className="px-[16px] py-[10px]">
        {editing ? (
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full h-[32px] px-[8px] rounded"
          />
        ) : (
          region.label
        )}
      </td>
      <td className="px-[16px] py-[10px]">
        <span
          className="inline-flex items-center px-[10px] py-[3px] rounded-full text-[11px] font-bold"
          style={
            region.active
              ? { backgroundColor: "rgba(51,228,255,0.15)", color: "#33e4ff" }
              : { backgroundColor: "var(--lp-surface-container-high)", color: "var(--lp-on-surface-variant)" }
          }
        >
          {region.active ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="px-[16px] py-[10px] text-right whitespace-nowrap">
        {editing ? (
          <span className="inline-flex items-center gap-[4px]">
            <button
              onClick={save}
              disabled={busy}
              className="h-[28px] px-[12px] rounded text-[12px] font-semibold"
              style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
            >
              {busy ? "…" : "Save"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setLabel(region.label);
              }}
              className="h-[28px] px-[12px] rounded border text-[12px]"
              style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)" }}
            >
              Cancel
            </button>
          </span>
        ) : (
          <span className="inline-flex items-center gap-[4px]">
            <IconBtn icon={region.active ? "toggle_on" : "toggle_off"} onClick={toggleActive} disabled={busy} />
            <IconBtn icon="edit" onClick={() => setEditing(true)} />
          </span>
        )}
      </td>
    </tr>
  );
}

function LockOverrideTab({ entries }: { entries: LockedEntry[] }) {
  return (
    <div className="space-y-[12px]">
      <Banner>Daily entries lock automatically 3 days after their entry date. You can unlock specific entries here for editing — every override is recorded in the audit log.</Banner>
      {entries.length === 0 ? (
        <div
          className="rounded-[12px] p-[24px] border text-center"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
            color: "var(--lp-on-surface-variant)",
          }}
        >
          No locked entries yet. Locked entries will appear here once daily-entry data starts being submitted (Phase B).
        </div>
      ) : (
        <div
          className="rounded-[12px] border overflow-hidden"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
          }}
        >
          <table className="w-full text-[14px]">
            <thead>
              <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                <Th>BDE</Th>
                <Th>Date</Th>
                <Th>Source</Th>
                <Th>Role</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <LockedEntryRow key={e.id} entry={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LockedEntryRow({ entry }: { entry: LockedEntry }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function unlock() {
    setBusy(true);
    const res = await fetch("/api/marketing/lead-pulse/lock-override", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: entry.userId, date: entry.entryDate }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <tr className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
      <td className="px-[16px] py-[10px] font-semibold">{entry.username}</td>
      <td className="px-[16px] py-[10px]">{entry.entryDate}</td>
      <td className="px-[16px] py-[10px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        {entry.sourceLabel}
      </td>
      <td className="px-[16px] py-[10px] uppercase text-[11px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        {entry.roleAtEntry}
      </td>
      <td className="px-[16px] py-[10px] text-right">
        <button
          type="button"
          onClick={unlock}
          disabled={busy}
          className="h-[28px] px-[12px] rounded text-[12px] font-semibold disabled:opacity-50"
          style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
        >
          {busy ? "…" : "Unlock"}
        </button>
      </td>
    </tr>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[8px] px-[12px] py-[8px] text-[12px] flex items-start gap-[8px]"
      style={{
        backgroundColor: "rgba(250,204,21,0.08)",
        color: "var(--lp-on-surface-variant)",
        borderLeft: "3px solid var(--lp-primary)",
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--lp-primary)" }}>
        info
      </span>
      <span>{children}</span>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={"px-[16px] py-[10px] text-[11px] font-bold uppercase tracking-widest " + className}
      style={{ color: "var(--lp-on-surface-variant)" }}
    >
      {children}
    </th>
  );
}

function IconBtn({
  icon,
  onClick,
  disabled,
}: {
  icon: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="p-[4px] disabled:opacity-40"
      style={{ color: "var(--lp-on-surface-variant)" }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
        {icon}
      </span>
    </button>
  );
}

function NewSourceButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", label: "", displayOrder: 100 });

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch("/api/marketing/lead-pulse/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: form.code,
        label: form.label,
        displayOrder: form.displayOrder,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data?.error === "code_taken"
          ? "Code already in use."
          : data?.error === "validation_failed"
            ? "Code must be lowercase letters/digits/underscore."
            : "Failed.",
      );
      return;
    }
    setOpen(false);
    setForm({ code: "", label: "", displayOrder: 100 });
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-[6px] h-[36px] px-[16px] rounded-[8px] text-[13px] font-semibold transition"
        style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
        Add source
      </button>
      {open &&
        mounted &&
        createPortal(
          <Modal busy={busy} onClose={() => !busy && setOpen(false)}>
            <form onSubmit={submit} className="space-y-[16px]">
              <h3 className="text-[18px] font-semibold">New source</h3>
              <Field label="Code (lowercase, no spaces)">
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  required
                  pattern="[a-z0-9_]+"
                  className="w-full h-[40px] px-[12px] rounded-[8px]"
                />
              </Field>
              <Field label="Label">
                <input
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  required
                  className="w-full h-[40px] px-[12px] rounded-[8px]"
                />
              </Field>
              <Field label="Display order">
                <input
                  type="number"
                  value={form.displayOrder}
                  onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) || 0 })}
                  className="w-full h-[40px] px-[12px] rounded-[8px]"
                />
              </Field>
              {error && <ErrorMsg>{error}</ErrorMsg>}
              <ModalActions
                busy={busy}
                onCancel={() => setOpen(false)}
                submitLabel="Add source"
              />
            </form>
          </Modal>,
          document.body,
        )}
    </>
  );
}

function NewRegionButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", label: "" });

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch("/api/marketing/lead-pulse/regions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: form.code, label: form.label }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data?.error === "code_taken"
          ? "Code already in use."
          : data?.error === "validation_failed"
            ? "Code must be lowercase letters/digits/underscore."
            : "Failed.",
      );
      return;
    }
    setOpen(false);
    setForm({ code: "", label: "" });
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-[6px] h-[36px] px-[16px] rounded-[8px] text-[13px] font-semibold transition"
        style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
        Add region
      </button>
      {open &&
        mounted &&
        createPortal(
          <Modal busy={busy} onClose={() => !busy && setOpen(false)}>
            <form onSubmit={submit} className="space-y-[16px]">
              <h3 className="text-[18px] font-semibold">New region</h3>
              <Field label="Code (lowercase, no spaces)">
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  required
                  pattern="[a-z0-9_]+"
                  className="w-full h-[40px] px-[12px] rounded-[8px]"
                />
              </Field>
              <Field label="Label">
                <input
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  required
                  className="w-full h-[40px] px-[12px] rounded-[8px]"
                />
              </Field>
              {error && <ErrorMsg>{error}</ErrorMsg>}
              <ModalActions
                busy={busy}
                onCancel={() => setOpen(false)}
                submitLabel="Add region"
              />
            </form>
          </Modal>,
          document.body,
        )}
    </>
  );
}

function Modal({
  children,
  onClose,
  busy,
}: {
  children: React.ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center p-[16px]"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="lp-scope w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[12px] p-[24px] border"
        style={{
          backgroundColor: "var(--lp-surface-container-high)",
          borderColor: "var(--lp-outline-variant)",
          color: "var(--lp-on-surface)",
          ["--lp-surface-container-low" as string]: "#1f1b11",
          ["--lp-outline-variant" as string]: "#4d4632",
          ["--lp-on-surface" as string]: "#ebe2d0",
          ["--lp-on-surface-variant" as string]: "#d1c6ab",
          ["--lp-primary" as string]: "#facc15",
          ["--lp-on-primary" as string]: "#3c2f00",
          ["--lp-error" as string]: "#ffb4ab",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  busy,
  onCancel,
  submitLabel,
}: {
  busy: boolean;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <div className="flex items-center gap-[8px] pt-[8px]">
      <button
        type="submit"
        disabled={busy}
        className="h-[40px] px-[20px] rounded-[8px] text-[14px] font-semibold disabled:opacity-60"
        style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
      >
        {busy ? "…" : submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="h-[40px] px-[20px] rounded-[8px] border text-[14px]"
        style={{
          borderColor: "var(--lp-outline-variant)",
          color: "var(--lp-on-surface-variant)",
        }}
      >
        Cancel
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span
        className="block text-[11px] font-bold uppercase tracking-widest mb-[6px]"
        style={{ color: "var(--lp-on-surface-variant)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function ErrorMsg({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded px-[12px] py-[8px] text-[13px]"
      style={{ backgroundColor: "rgba(255,180,171,0.15)", color: "var(--lp-error)" }}
    >
      {children}
    </div>
  );
}

/**
 * One-shot fix for the year-typo on Anila's January 2027 entries.
 * Shifts any LeadPulseDailyEntry / Meta with year=2027 back to 2026
 * (same month + day). Idempotent.
 */
export function Fix2027TypoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{
    summary: Record<string, number>;
    log: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/marketing/lead-pulse/fix-2027-typo", {
      method: "POST",
    });
    setBusy(false);
    setConfirming(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? "fix_failed");
      return;
    }
    setResult(await res.json());
    router.refresh();
  }

  return (
    <div
      className="rounded-[12px] p-[20px] border"
      style={{
        backgroundColor: "var(--lp-surface-container)",
        borderColor: "var(--lp-outline-variant)",
      }}
    >
      <div className="flex items-start gap-[16px]">
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold" style={{ color: "var(--lp-on-surface)" }}>
            Fix 2027 year-typo (Anila&apos;s January)
          </h3>
          <p className="text-[12px] mt-[4px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            Rows 6-10 of the <code>Anila(L2)</code> sheet were typed
            with year 2027 instead of 2026 — only one cell carries a
            non-zero value (Wabis = 12 on 2027-01-03) but it shows up
            on the dashboard as a stray future month. This shifts every
            year=2027 entry back to 2026 with the same month-day.
            Idempotent.
          </p>
        </div>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="shrink-0 h-[36px] px-[14px] rounded-[8px] text-[13px] font-semibold disabled:opacity-60"
            style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
          >
            Fix
          </button>
        ) : (
          <div className="shrink-0 flex items-center gap-[8px]">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="h-[36px] px-[14px] rounded-[8px] text-[13px] font-semibold disabled:opacity-60"
              style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
            >
              {busy ? "Running…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="h-[36px] px-[14px] rounded-[8px] text-[13px] border"
              style={{
                borderColor: "var(--lp-outline-variant)",
                color: "var(--lp-on-surface-variant)",
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {error && (
        <div
          className="mt-[12px] rounded-[8px] px-[12px] py-[8px] text-[12px]"
          style={{ backgroundColor: "rgba(255,180,171,0.15)", color: "var(--lp-error)" }}
        >
          {error}
        </div>
      )}
      {result && (
        <div
          className="mt-[12px] rounded-[8px] px-[12px] py-[10px] text-[12px] space-y-[6px]"
          style={{
            backgroundColor: "var(--lp-surface-container-low)",
            color: "var(--lp-on-surface)",
          }}
        >
          <p className="font-semibold">Fix complete:</p>
          <ul
            className="grid grid-cols-2 gap-x-[16px] gap-y-[2px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            {Object.entries(result.summary).map(([k, v]) => (
              <li key={k}>
                <span className="font-mono">{v}</span>{" "}
                {k.replace(/([A-Z])/g, " $1").toLowerCase()}
              </li>
            ))}
          </ul>
          {result.log.length > 0 && (
            <details>
              <summary
                className="cursor-pointer"
                style={{ color: "var(--lp-on-surface-variant)" }}
              >
                Per-row detail ({result.log.length})
              </summary>
              <ul
                className="mt-[4px] text-[11px] font-mono"
                style={{ color: "var(--lp-on-surface-variant)" }}
              >
                {result.log.map((l, i) => (
                  <li key={i}>· {l}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Read-only spot-check that re-parses the bundled Excel and compares
 * each (BDE, date, source) cell against the DB. Optional BDE name
 * filter narrows the check. Shows mismatches inline.
 */
export function ReconcileHistoricalButton() {
  const [busy, setBusy] = useState(false);
  const [bdeFilter, setBdeFilter] = useState("");
  const [result, setResult] = useState<{
    totals: { bdes: number; cellsChecked: number; cellsMatching: number; cellsMismatching: number };
    perBde: Array<{
      bde: string;
      role: "l1" | "l2";
      excelDays: number;
      dbDays: number;
      cellsChecked: number;
      cellsMatching: number;
      cellsMismatching: number;
      missingFromDb: number;
      extraInDb: number;
      sampleMismatches: Array<{
        bde: string;
        date: string;
        source: string;
        excelLeads: number;
        dbLeads: number;
        excelConversion: number;
        dbConversion: number;
      }>;
    }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const qs = bdeFilter.trim() ? `?bde=${encodeURIComponent(bdeFilter.trim())}` : "";
    const res = await fetch(`/api/marketing/lead-pulse/reconcile-historical${qs}`);
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        (data as { message?: string }).message ??
          (data as { error?: string }).error ??
          "Reconcile failed.",
      );
      return;
    }
    setResult(await res.json());
  }

  return (
    <div
      className="rounded-[12px] p-[20px] border"
      style={{
        backgroundColor: "var(--lp-surface-container)",
        borderColor: "var(--lp-outline-variant)",
      }}
    >
      <div className="flex items-start gap-[16px]">
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold" style={{ color: "var(--lp-on-surface)" }}>
            Reconcile DB against historical Excel
          </h3>
          <p
            className="text-[12px] mt-[4px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            Read-only spot-check. Re-parses the bundled Excel and compares each
            (BDE, date, source) cell to the live DB. Reports cells that match,
            mismatches with deltas, and any keys present on one side but not
            the other. Optional filter narrows to a single BDE by name.
          </p>
        </div>
      </div>
      <div className="mt-[12px] flex items-center gap-[8px]">
        <input
          type="text"
          value={bdeFilter}
          onChange={(e) => setBdeFilter(e.target.value)}
          placeholder="BDE name filter (e.g. Sreeshma) — empty = all"
          className="flex-1 h-[36px] px-[12px] rounded-[8px] text-[13px]"
          style={{
            backgroundColor: "var(--lp-surface-container-low)",
            border: "1px solid var(--lp-outline-variant)",
            color: "var(--lp-on-surface)",
          }}
        />
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="shrink-0 h-[36px] px-[14px] rounded-[8px] text-[13px] font-semibold disabled:opacity-60"
          style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
        >
          {busy ? "Reconciling…" : "Run reconcile"}
        </button>
      </div>
      {error && (
        <div
          className="mt-[12px] rounded-[8px] px-[12px] py-[8px] text-[12px]"
          style={{
            backgroundColor: "rgba(255,180,171,0.15)",
            color: "var(--lp-error)",
          }}
        >
          {error}
        </div>
      )}
      {result && (
        <div
          className="mt-[12px] rounded-[8px] px-[12px] py-[10px] text-[12px] space-y-[8px]"
          style={{
            backgroundColor: "var(--lp-surface-container-low)",
            color: "var(--lp-on-surface)",
          }}
        >
          <div className="font-semibold">
            {result.totals.bdes} BDE{result.totals.bdes === 1 ? "" : "s"} ·{" "}
            <span className="font-mono">{result.totals.cellsChecked}</span> cells checked ·{" "}
            <span
              className="font-mono"
              style={{
                color:
                  result.totals.cellsMismatching === 0
                    ? "var(--lp-cyan)"
                    : "var(--lp-error)",
              }}
            >
              {result.totals.cellsMismatching} mismatches
            </span>
            {result.totals.cellsMismatching === 0 ? " ✓" : ""}
          </div>
          <details>
            <summary
              className="cursor-pointer"
              style={{ color: "var(--lp-on-surface-variant)" }}
            >
              Per-BDE breakdown ({result.perBde.length})
            </summary>
            <table className="w-full mt-[6px] text-[11px] tabular-nums">
              <thead>
                <tr style={{ color: "var(--lp-on-surface-variant)" }}>
                  <th className="text-left px-[4px]">BDE</th>
                  <th className="text-right px-[4px]">Role</th>
                  <th className="text-right px-[4px]">Cells</th>
                  <th className="text-right px-[4px]">Match</th>
                  <th className="text-right px-[4px]">Mismatch</th>
                  <th className="text-right px-[4px]">Missing</th>
                  <th className="text-right px-[4px]">Extra</th>
                </tr>
              </thead>
              <tbody>
                {result.perBde.map((b) => (
                  <tr
                    key={b.bde}
                    style={{
                      color:
                        b.cellsMismatching || b.missingFromDb || b.extraInDb
                          ? "var(--lp-on-surface)"
                          : "var(--lp-on-surface-variant)",
                    }}
                  >
                    <td className="px-[4px]">{b.bde}</td>
                    <td className="text-right px-[4px] uppercase">{b.role}</td>
                    <td className="text-right px-[4px]">{b.cellsChecked}</td>
                    <td className="text-right px-[4px]">{b.cellsMatching}</td>
                    <td
                      className="text-right px-[4px] font-semibold"
                      style={{
                        color: b.cellsMismatching ? "var(--lp-error)" : undefined,
                      }}
                    >
                      {b.cellsMismatching}
                    </td>
                    <td className="text-right px-[4px]">{b.missingFromDb}</td>
                    <td className="text-right px-[4px]">{b.extraInDb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          {result.perBde.some((b) => b.sampleMismatches.length > 0) && (
            <details>
              <summary
                className="cursor-pointer"
                style={{ color: "var(--lp-on-surface-variant)" }}
              >
                Sample mismatches (first 30 per BDE)
              </summary>
              <ul
                className="mt-[6px] text-[11px] font-mono space-y-[2px]"
                style={{ color: "var(--lp-on-surface-variant)" }}
              >
                {result.perBde.flatMap((b) =>
                  b.sampleMismatches.map((m, i) => (
                    <li key={`${b.bde}-${i}`}>
                      · <span style={{ color: "var(--lp-on-surface)" }}>{m.bde}</span>{" "}
                      {m.date} {m.source}: leads {m.excelLeads}→{m.dbLeads}, conv{" "}
                      {m.excelConversion}→{m.dbConversion}
                    </li>
                  )),
                )}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Supervisor-only one-shot import that POSTs to
 * /api/marketing/lead-pulse/import-historical and ingests the bundled
 * `public/data/lead-pulse-historical.xlsx` into LeadPulseDailyEntry,
 * LeadPulseDailyMeta, and LeadPulseRole. Idempotent — re-runs upsert.
 */
export function HistoricalImportButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{
    summary: Record<string, number>;
    bdes: string[];
    errors: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/marketing/lead-pulse/import-historical", {
      method: "POST",
    });
    setBusy(false);
    setConfirming(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        (data as { message?: string }).message ??
          (data as { error?: string }).error ??
          "Import failed.",
      );
      return;
    }
    const data = (await res.json()) as {
      summary: Record<string, number>;
      bdes: string[];
      errors: string[];
    };
    setResult(data);
    router.refresh();
  }

  return (
    <div
      className="rounded-[12px] p-[20px] border"
      style={{
        backgroundColor: "var(--lp-surface-container)",
        borderColor: "var(--lp-outline-variant)",
      }}
    >
      <div className="flex items-start gap-[16px]">
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold" style={{ color: "var(--lp-on-surface)" }}>
            Import historical Lead Pulse data
          </h3>
          <p
            className="text-[12px] mt-[4px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            Loads the bundled <code>New_SALES_REPORT_FIXED.xlsx</code> (19 BDE
            sheets, ~6 months of daily history) into the live DB. Creates
            LeadPulseRole rows for any BDE not yet on the roster, auto-creates
            placeholder DESFIN users if needed, then upserts daily entries
            (locked + submitted). Safe to re-run; second click is a clean
            update of any rows that have already landed.
          </p>
        </div>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="shrink-0 h-[36px] px-[14px] rounded-[8px] text-[13px] font-semibold disabled:opacity-60"
            style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
          >
            Run import
          </button>
        ) : (
          <div className="shrink-0 flex items-center gap-[8px]">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="h-[36px] px-[14px] rounded-[8px] text-[13px] font-semibold disabled:opacity-60"
              style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
            >
              {busy ? "Importing… (60-180s)" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="h-[36px] px-[14px] rounded-[8px] text-[13px] border"
              style={{
                borderColor: "var(--lp-outline-variant)",
                color: "var(--lp-on-surface-variant)",
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {error && (
        <div
          className="mt-[12px] rounded-[8px] px-[12px] py-[8px] text-[12px]"
          style={{
            backgroundColor: "rgba(255,180,171,0.15)",
            color: "var(--lp-error)",
          }}
        >
          {error}
        </div>
      )}
      {result && (
        <div
          className="mt-[12px] rounded-[8px] px-[12px] py-[10px] text-[12px] space-y-[6px]"
          style={{
            backgroundColor: "var(--lp-surface-container-low)",
            color: "var(--lp-on-surface)",
          }}
        >
          <p className="font-semibold">Import complete:</p>
          <ul
            className="grid grid-cols-2 gap-x-[16px] gap-y-[2px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            {Object.entries(result.summary).map(([k, v]) => (
              <li key={k}>
                <span className="font-mono">{v}</span>{" "}
                {k.replace(/([A-Z])/g, " $1").toLowerCase()}
              </li>
            ))}
          </ul>
          {result.bdes.length > 0 && (
            <details className="mt-[6px]">
              <summary
                className="cursor-pointer"
                style={{ color: "var(--lp-on-surface-variant)" }}
              >
                BDEs imported ({result.bdes.length})
              </summary>
              <ul
                className="mt-[4px] text-[11px] font-mono"
                style={{ color: "var(--lp-on-surface-variant)" }}
              >
                {result.bdes.map((b, i) => (
                  <li key={i}>· {b}</li>
                ))}
              </ul>
            </details>
          )}
          {result.errors.length > 0 && (
            <details className="mt-[6px]">
              <summary className="cursor-pointer" style={{ color: "var(--lp-error)" }}>
                Errors ({result.errors.length})
              </summary>
              <ul className="mt-[4px] text-[11px] font-mono" style={{ color: "var(--lp-error)" }}>
                {result.errors.map((e, i) => (
                  <li key={i}>· {e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
