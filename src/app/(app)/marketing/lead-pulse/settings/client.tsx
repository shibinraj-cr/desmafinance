"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Source = { id: string; code: string; label: string; displayOrder: number; active: boolean };
type Region = { id: string; code: string; label: string; active: boolean };
type LockedEntry = {
  id: string;
  username: string;
  sourceLabel: string;
  entryDate: string;
  submittedAt: string | null;
  roleAtEntry: string;
};

type TabKey = "sources" | "regions" | "lock-override";

export function SettingsTabs({
  initialTab,
  sources,
  regions,
  lockedEntries,
}: {
  initialTab: TabKey;
  sources: Source[];
  regions: Region[];
  lockedEntries: LockedEntry[];
}) {
  const [tab, setTab] = useState<TabKey>(initialTab);

  return (
    <div className="space-y-[16px]">
      <div className="flex items-center gap-[4px] border-b" style={{ borderColor: "var(--lp-outline-variant)" }}>
        {(["sources", "regions", "lock-override"] as const).map((t) => (
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
            {t === "sources" ? "Lead Sources" : t === "regions" ? "Regions" : "Lock Override"}
          </button>
        ))}
      </div>

      {tab === "sources" && <SourcesTab sources={sources} />}
      {tab === "regions" && <RegionsTab regions={regions} />}
      {tab === "lock-override" && <LockOverrideTab entries={lockedEntries} />}
    </div>
  );
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
  // Phase A only lists entries — actually unlocking arrives with Phase B
  // when daily-entry routes exist. Show a disabled "Unlock" button so the
  // affordance is visible.
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
          disabled
          title="Unlock arrives with Phase B (Daily Entry)"
          className="h-[28px] px-[12px] rounded text-[12px] font-semibold opacity-50 cursor-not-allowed"
          style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
        >
          Unlock
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
