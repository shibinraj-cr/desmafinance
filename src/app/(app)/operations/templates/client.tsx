"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

type StepDTO = {
  id: string;
  seq: number;
  name: string;
  description: string | null;
  phase: string | null;
  isRequired: boolean;
  slaDays: number | null;
};
type TemplateDTO = {
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
  steps: StepDTO[];
};
type ServiceLite = { id: string; name: string };

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";
const taCls =
  "w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";
const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
const secondaryBtn =
  "h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
    </label>
  );
}
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: size }}>
      {name}
    </span>
  );
}
function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={"px-md py-sm text-label-sm uppercase tracking-wider " + className}>{children}</th>;
}
function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={"px-md py-sm align-middle " + className}>{children}</td>;
}

async function api(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return { ok: true };
  const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return { ok: false, error: d.message || d.error || "Request failed." };
}

export function TemplatesClient({ templates, services }: { templates: TemplateDTO[]; services: ServiceLite[] }) {
  const activeServiceIds = new Set(templates.filter((t) => t.isActive).map((t) => t.serviceId));
  const servicesWithout = services.filter((s) => !activeServiceIds.has(s.id));
  const [newFor, setNewFor] = useState<string | null>(null); // serviceId pre-selected, or "" for open picker
  const [newOpen, setNewOpen] = useState(false);

  function openNew(serviceId?: string) {
    setNewFor(serviceId ?? "");
    setNewOpen(true);
  }

  return (
    <div className="space-y-lg">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <div>
          <h2 className="text-h2 text-on-surface">Process templates</h2>
          <p className="text-body-sm text-on-surface-variant">
            One active template per service. Each template is an ordered list of steps that becomes a candidate&rsquo;s
            task checklist when they enrol.
          </p>
        </div>
        <button type="button" onClick={() => openNew()} className={primaryBtn + " inline-flex items-center gap-xs"}>
          <Icon name="add" /> New template
        </button>
      </div>

      {servicesWithout.length > 0 && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-low p-md">
          <div className="text-label-sm text-on-surface-variant mb-xs">Services without a process template yet</div>
          <div className="flex flex-wrap gap-xs">
            {servicesWithout.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => openNew(s.id)}
                className="inline-flex items-center gap-xs h-8 px-md rounded-full border border-outline-variant text-label-sm hover:bg-surface-container transition"
              >
                <Icon name="add" size={16} /> {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center text-on-surface-variant">
          No templates yet. Create one to define a service&rsquo;s process steps.
        </div>
      ) : (
        <div className="space-y-lg">
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} />
          ))}
        </div>
      )}

      {newOpen && <NewTemplateModal services={services} preselect={newFor} onClose={() => setNewOpen(false)} />}
    </div>
  );
}

// ── Template card (header + steps editor) ──────────────────────────────────
function TemplateCard({ template }: { template: TemplateDTO }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [name, setName] = useState(template.name);
  const [stepModal, setStepModal] = useState<{ step: StepDTO | null } | null>(null);

  async function run(p: Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setErr(null);
    const r = await p;
    setBusy(false);
    if (!r.ok) {
      setErr(r.error ?? "Failed.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function saveHeader() {
    if (await run(api(`/api/operations/templates/${template.id}`, "PATCH", { name: name.trim() }))) {
      setEditingHeader(false);
    }
  }
  async function toggleActive() {
    await run(api(`/api/operations/templates/${template.id}`, "PATCH", { isActive: !template.isActive }));
  }
  async function removeTemplate() {
    if (!confirm(`Delete template "${template.name}" (v${template.version})? This cannot be undone.`)) return;
    await run(api(`/api/operations/templates/${template.id}`, "DELETE"));
  }
  async function move(idx: number, dir: -1 | 1) {
    const order = template.steps.map((s) => s.id);
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    await run(api(`/api/operations/templates/${template.id}/steps`, "PUT", { orderedIds: order }));
  }
  async function removeStep(step: StepDTO) {
    if (!confirm(`Delete step "${step.name}"?`)) return;
    await run(api(`/api/operations/templates/${template.id}/steps/${step.id}`, "DELETE"));
  }

  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
      <div className="border-l-4 border-primary">
        <div className="flex flex-wrap items-start justify-between gap-md px-lg py-md border-b border-outline-variant">
          <div className="min-w-0">
            <div className="flex items-center gap-xs flex-wrap">
              <span className="text-label-sm font-semibold uppercase tracking-wider text-primary">{template.serviceName}</span>
              <span className="text-label-sm px-xs rounded bg-surface-container-high text-on-surface-variant">v{template.version}</span>
              {template.isActive ? (
                <span className="text-label-sm px-xs rounded bg-primary text-on-primary">Active</span>
              ) : (
                <span className="text-label-sm px-xs rounded bg-surface-container-high text-on-surface-variant">Inactive</span>
              )}
            </div>
            {editingHeader ? (
              <div className="mt-xs flex items-center gap-xs">
                <input className={inputCls + " max-w-sm"} value={name} onChange={(e) => setName(e.target.value)} />
                <button type="button" disabled={busy} onClick={saveHeader} className="text-primary text-label-sm font-semibold hover:underline">
                  Save
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setName(template.name);
                    setEditingHeader(false);
                  }}
                  className="text-on-surface-variant text-label-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <h3 className="text-h3 text-on-surface mt-xs inline-flex items-center gap-xs">
                {template.name}
                <button type="button" onClick={() => setEditingHeader(true)} className="text-on-surface-variant hover:text-accent" title="Rename">
                  <Icon name="edit" size={16} />
                </button>
              </h3>
            )}
            <p className="text-label-sm text-on-surface-variant mt-xs">
              {template.steps.length} step{template.steps.length === 1 ? "" : "s"} · {template.projectCount} project
              {template.projectCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-xs">
            {!template.isActive && (
              <button type="button" disabled={busy} onClick={toggleActive} className={secondaryBtn + " h-9 text-label-sm"}>
                Make active
              </button>
            )}
            {template.isActive && (
              <button type="button" disabled={busy} onClick={toggleActive} className={secondaryBtn + " h-9 text-label-sm"} title="Deactivate">
                Deactivate
              </button>
            )}
            <button
              type="button"
              disabled={busy || template.projectCount > 0}
              onClick={removeTemplate}
              title={template.projectCount > 0 ? `Used by ${template.projectCount} projects — deactivate instead` : "Delete template"}
              className="h-9 w-9 grid place-items-center rounded-lg text-on-surface-variant hover:text-error hover:bg-surface-container-low disabled:opacity-40"
            >
              <Icon name="delete" />
            </button>
          </div>
        </div>

        {err && <div className="px-lg pt-sm text-label-sm text-error">{err}</div>}

        <div className="overflow-auto">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container-low text-on-surface-variant">
              <tr>
                <Th className="text-left w-[88px]">Order</Th>
                <Th className="text-left">Phase</Th>
                <Th className="text-left">Step</Th>
                <Th className="text-center w-[96px]">Required</Th>
                <Th className="text-right w-[96px]">SLA (days)</Th>
                <Th className="text-right w-[88px]">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {template.steps.length === 0 ? (
                <tr>
                  <Td className="text-on-surface-variant" >&nbsp;</Td>
                  <Td className="text-on-surface-variant" >&nbsp;</Td>
                  <Td className="text-on-surface-variant py-md">No steps yet — add the first one.</Td>
                  <Td>&nbsp;</Td>
                  <Td>&nbsp;</Td>
                  <Td>&nbsp;</Td>
                </tr>
              ) : (
                template.steps.map((s, i) => (
                  <tr key={s.id} className="border-t border-outline-variant/60">
                    <Td>
                      <span className="inline-flex items-center gap-xs">
                        <span className="text-on-surface-variant tabular-nums w-5 text-right">{i + 1}</span>
                        <span className="inline-flex flex-col">
                          <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} className="text-on-surface-variant hover:text-accent disabled:opacity-30" title="Move up">
                            <Icon name="keyboard_arrow_up" size={16} />
                          </button>
                          <button type="button" disabled={busy || i === template.steps.length - 1} onClick={() => move(i, 1)} className="text-on-surface-variant hover:text-accent disabled:opacity-30" title="Move down">
                            <Icon name="keyboard_arrow_down" size={16} />
                          </button>
                        </span>
                      </span>
                    </Td>
                    <Td className="text-on-surface-variant">{s.phase || "—"}</Td>
                    <Td>
                      <div className="font-medium text-on-surface">{s.name}</div>
                      {s.description && <div className="text-label-sm text-on-surface-variant">{s.description}</div>}
                    </Td>
                    <Td className="text-center">
                      {s.isRequired ? (
                        <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>check_circle</span>
                      ) : (
                        <span className="text-on-surface-variant">optional</span>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums">{s.slaDays ?? "—"}</Td>
                    <Td className="text-right">
                      <span className="inline-flex gap-xs">
                        <button type="button" onClick={() => setStepModal({ step: s })} className="text-on-surface-variant hover:text-accent" title="Edit">
                          <Icon name="edit" size={16} />
                        </button>
                        <button type="button" disabled={busy} onClick={() => removeStep(s)} className="text-on-surface-variant hover:text-error" title="Delete">
                          <Icon name="delete" size={16} />
                        </button>
                      </span>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-lg py-md border-t border-outline-variant">
          <button type="button" onClick={() => setStepModal({ step: null })} className="inline-flex items-center gap-xs text-primary text-label-sm font-semibold hover:underline">
            <Icon name="add" size={18} /> Add step
          </button>
        </div>
      </div>

      {stepModal && <StepFormModal templateId={template.id} step={stepModal.step} onClose={() => setStepModal(null)} />}
    </section>
  );
}

// ── New template modal ─────────────────────────────────────────────────────
function NewTemplateModal({ services, preselect, onClose }: { services: ServiceLite[]; preselect: string | null; onClose: () => void }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ serviceId: preselect || "", name: "", description: "" });
  useEffect(() => setMounted(true), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.serviceId) {
      setError("Pick a service.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await api("/api/operations/templates", "POST", {
      serviceId: form.serviceId,
      name: form.name.trim(),
      description: form.description.trim() || null,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Failed to create.");
      return;
    }
    onClose();
    router.refresh();
  }

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md" onClick={() => !busy && onClose()}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
      >
        <h3 className="text-h3 text-on-surface">New process template</h3>
        {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">{error}</div>}
        <Field label="Service">
          <select className={inputCls} value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
            <option value="">Select a service…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Template name">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. AHPRA Registration Process" autoFocus />
        </Field>
        <Field label="Description (optional)">
          <textarea className={taCls} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <p className="text-label-sm text-on-surface-variant">
          If this service already has a template, a new version is created and made active; the previous version is kept for in-flight
          projects.
        </p>
        <div className="flex justify-end gap-base">
          <button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryBtn} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

// ── Add / edit step modal ──────────────────────────────────────────────────
function StepFormModal({ templateId, step, onClose }: { templateId: string; step: StepDTO | null; onClose: () => void }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: step?.name ?? "",
    phase: step?.phase ?? "",
    description: step?.description ?? "",
    isRequired: step?.isRequired ?? true,
    slaDays: step?.slaDays != null ? String(step.slaDays) : "",
  });
  useEffect(() => setMounted(true), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Step name is required.");
      return;
    }
    const slaTrim = form.slaDays.trim();
    const payload = {
      name: form.name.trim(),
      phase: form.phase.trim() || null,
      description: form.description.trim() || null,
      isRequired: form.isRequired,
      slaDays: slaTrim === "" ? null : Number(slaTrim),
    };
    if (payload.slaDays != null && (!Number.isInteger(payload.slaDays) || payload.slaDays < 0)) {
      setError("SLA must be a whole number of days.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = step
      ? await api(`/api/operations/templates/${templateId}/steps/${step.id}`, "PATCH", payload)
      : await api(`/api/operations/templates/${templateId}/steps`, "POST", payload);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Failed to save.");
      return;
    }
    onClose();
    router.refresh();
  }

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md" onClick={() => !busy && onClose()}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
      >
        <h3 className="text-h3 text-on-surface">{step ? "Edit step" : "Add step"}</h3>
        {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">{error}</div>}
        <Field label="Step name">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-md">
          <Field label="Phase (optional)">
            <input className={inputCls} value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })} placeholder="e.g. Initial" />
          </Field>
          <Field label="SLA in business days (optional)">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={form.slaDays}
              onChange={(e) => setForm({ ...form, slaDays: e.target.value })}
              placeholder="e.g. 5"
            />
          </Field>
        </div>
        <Field label="Description (optional)">
          <textarea className={taCls} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <label className="flex items-center gap-xs text-body-md">
          <input type="checkbox" checked={form.isRequired} onChange={(e) => setForm({ ...form, isRequired: e.target.checked })} />
          Required step (must be completed before the project can finish)
        </label>
        <div className="flex justify-end gap-base">
          <button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryBtn} disabled={busy}>
            {busy ? "Saving…" : step ? "Save" : "Add step"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
