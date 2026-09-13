"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Shared presentation primitives for the SOP module.
 *
 * These are the same class strings the Operations and CRM clients use inline —
 * lifted into one file because the SOP module has a dozen screens and a
 * hand-copied input class is how two of them end up a pixel apart. No new
 * design tokens: everything below is built from the existing
 * surface / outline / primary palette in tailwind.config.ts.
 */

export const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md disabled:opacity-60 disabled:bg-surface-container-low";
export const taCls =
  "w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md disabled:opacity-60";
export const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60 disabled:cursor-not-allowed";
export const secondaryBtn =
  "h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";
export const dangerBtn =
  "h-10 px-lg rounded-lg border border-error text-error hover:bg-error-container transition disabled:opacity-60";
export const chipBtn =
  "inline-flex items-center gap-xs h-8 px-md rounded-full border border-outline-variant text-label-sm hover:bg-surface-container transition";

export function Icon({ name, size = 18, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <span className={"material-symbols-outlined " + className} style={{ fontSize: size }} aria-hidden>
      {name}
    </span>
  );
}

export function Field({
  label,
  children,
  hint,
  required,
  error,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
  error?: string | null;
}) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">
        {label}
        {required && <span className="text-error ml-xs">*</span>}
      </span>
      {children}
      {hint && !error && <span className="block text-caption text-on-surface-variant mt-xs">{hint}</span>}
      {error && <span className="block text-caption text-error mt-xs">{error}</span>}
    </label>
  );
}

export function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={"px-md py-sm text-left text-label-sm uppercase tracking-wider text-on-surface-variant " + className}>
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={"px-md py-sm align-middle text-body-md " + className}>{children}</td>;
}

export function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={
        "inline-flex items-center whitespace-nowrap px-xs py-px rounded text-label-sm font-medium " + className
      }
    >
      {children}
    </span>
  );
}

/** Section shell — a titled card, used by every SOP screen. */
export function Section({
  title,
  description,
  action,
  children,
  id,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm scroll-mt-24"
    >
      <div className="flex flex-wrap items-start justify-between gap-md px-lg py-md border-b border-outline-variant">
        <div className="min-w-0">
          <h3 className="text-h3 text-on-surface">{title}</h3>
          {description && <p className="text-body-sm text-on-surface-variant mt-xs">{description}</p>}
        </div>
        {action ? <div className="flex items-center gap-xs flex-shrink-0">{action}</div> : null}
      </div>
      <div className="p-lg">{children}</div>
    </section>
  );
}

/** The empty state every list falls back to. */
export function Empty({ icon = "inbox", title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center">
      <Icon name={icon} size={36} className="text-outline" />
      <div className="text-body-lg text-on-surface mt-sm">{title}</div>
      {hint && <div className="text-body-sm text-on-surface-variant mt-xs">{hint}</div>}
    </div>
  );
}

/** Inline error banner — the standard way this module reports a failed call. */
export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-error bg-error-container text-on-error-container px-md py-sm text-body-sm"
    >
      {children}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-xs text-body-sm text-on-surface-variant" role="status">
      <span className="inline-block h-4 w-4 rounded-full border-2 border-outline-variant border-t-primary animate-spin" />
      {label}
    </div>
  );
}

/**
 * Modal dialog, portalled to the body so a parent's `overflow` cannot clip it.
 * Closes on Escape and on backdrop click; focus moves to the panel on open so
 * a keyboard user is not left behind on the page underneath.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-md sm:p-lg"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={
          "w-full bg-surface-container-lowest rounded-xl shadow-lg outline-none my-lg " +
          (wide ? "max-w-4xl" : "max-w-2xl")
        }
      >
        <div className="flex items-center justify-between gap-md px-lg py-md border-b border-outline-variant">
          <h3 className="text-h3 text-on-surface">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 grid place-items-center rounded-lg hover:bg-surface-container-low transition"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="p-lg space-y-md">{children}</div>
        {footer ? (
          <div className="flex flex-wrap justify-end gap-xs px-lg py-md border-t border-outline-variant">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation dialog for the destructive/irreversible actions (§25). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  tone = "primary",
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={tone === "danger" ? dangerBtn : primaryBtn}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-body-md text-on-surface-variant">{message}</div>
    </Modal>
  );
}

// ── Fetch helper ────────────────────────────────────────────────────────────

export type ApiResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/**
 * One JSON fetch wrapper for the whole module, so every client surfaces the
 * server's message rather than a generic "something went wrong". The API layer
 * returns `{ error, message }`, so the message is preferred when present.
 */
export async function sopApi<T = unknown>(
  url: string,
  method: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const payload = (await res.json().catch(() => ({}))) as
      | (T & { error?: string; message?: string })
      | Record<string, never>;
    if (res.ok) return { ok: true, data: payload as T };
    const p = payload as { error?: string; message?: string; issues?: { message?: string }[] };
    return {
      ok: false,
      error: p.message || p.issues?.[0]?.message || p.error || `Request failed (${res.status}).`,
    };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}

/** Upload a file (multipart) — attachments are the only such path. */
export async function sopUpload<T = unknown>(url: string, form: FormData): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { method: "POST", body: form });
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, data: payload as T };
    return {
      ok: false,
      error:
        (payload.message as string) || (payload.error as string) || `Upload failed (${res.status}).`,
    };
  } catch {
    return { ok: false, error: "Could not upload the file." };
  }
}

/**
 * Warn before leaving with unsaved edits (§25).
 *
 * `beforeunload` covers tab close and reload — the two cases React routing
 * cannot intercept. In-app navigation is guarded by the editor's own
 * confirmation on the Cancel button, since Next's App Router has no
 * route-change interception hook to hang this on.
 */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}

/** Local date input value ("2026-09-13") from an ISO string or Date. */
export function dateValue(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(+d)) return "";
  return d.toISOString().slice(0, 10);
}

/** "13 Sep 2026" — the module's one date format. */
export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "13 Sep 2026, 14:20" — for audit rows and timestamps. */
export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
