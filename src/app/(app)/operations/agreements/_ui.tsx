"use client";

import { upload } from "@vercel/blob/client";
import { MAX_TEMPLATE_PDF_BYTES, templateUploadPath } from "@/lib/esign/templates";

export const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";

export const taCls =
  "w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";

export const primaryBtn =
  "inline-flex items-center justify-center gap-xs px-md py-sm bg-primary text-on-primary rounded-md text-body-md font-semibold hover:opacity-90 disabled:opacity-50";

export const secondaryBtn =
  "inline-flex items-center justify-center gap-xs px-md py-sm rounded-md border border-outline-variant text-body-md font-semibold hover:bg-surface-container disabled:opacity-50";

export function Icon({ name, size = 18, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <span className={"material-symbols-outlined " + className} style={{ fontSize: size }} aria-hidden="true">
      {name}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
      {hint && <span className="block text-caption text-on-surface-variant mt-xs">{hint}</span>}
    </label>
  );
}

/** JSON request to our API; throws with the server's message on failure. */
export async function api<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data as { message?: string; error?: string; issues?: Array<{ message?: string }> };
    throw new Error(
      d.message ??
        d.issues?.[0]?.message ??
        (res.status === 403 ? "You do not have access to this." : "Something went wrong. Try again."),
    );
  }
  return data as T;
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant w-full max-w-lg p-lg space-y-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-h3 font-bold break-words">{title}</h3>
          {subtitle && <p className="text-body-md text-on-surface-variant mt-xs break-words">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** A file the person picked, checked before any upload starts. */
export function checkPdfFile(file: File | null): string | null {
  if (!file) return "Choose a PDF.";
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return "That file is not a PDF.";
  if (file.size > MAX_TEMPLATE_PDF_BYTES) return `That PDF is over ${MAX_TEMPLATE_PDF_BYTES / (1024 * 1024)} MB.`;
  return null;
}

/**
 * Send a PDF straight to the private Blob store. Returns the stored pathname,
 * which the caller registers with the API (which re-checks the bytes).
 */
export async function uploadTemplatePdf(file: File, onProgress?: (pct: number) => void): Promise<string> {
  // The SDK throttles progress events, so one can arrive after the upload has
  // settled — and, if the next step failed, put the form back into "uploading"
  // with Cancel disabled. Ignore anything reported after we return.
  let settled = false;
  try {
    const blob = await upload(templateUploadPath(file.name), file, {
      access: "private",
      handleUploadUrl: "/api/esign/upload",
      contentType: "application/pdf",
      onUploadProgress: ({ percentage }) => {
        if (!settled) onProgress?.(Math.round(percentage));
      },
    });
    return blob.pathname;
  } finally {
    settled = true;
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}
