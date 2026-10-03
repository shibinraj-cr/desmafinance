"use client";

import { useState } from "react";

export const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";

export const primaryBtn =
  "inline-flex items-center justify-center gap-xs px-md py-sm bg-primary text-on-primary rounded-md text-body-md font-semibold hover:opacity-90 disabled:opacity-50";

export const secondaryBtn =
  "inline-flex items-center justify-center gap-xs px-md py-sm rounded-md border border-outline-variant text-body-md font-semibold hover:bg-surface-container disabled:opacity-50";

/** JSON request to our API; throws with the server's message on failure. */
export async function api<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { message?: string }).message ??
        (res.status === 403 ? "You do not have access to Documents" : "Something went wrong. Try again."),
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
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant w-full max-w-lg p-lg space-y-md shadow-xl">
        <div>
          <h3 className="text-h3 font-bold break-words">{title}</h3>
          {subtitle && <p className="text-body-md text-on-surface-variant mt-xs break-words">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={secondaryBtn}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this link", text);
        }
      }}
    >
      <span className="material-symbols-outlined text-[18px]">{copied ? "check" : "content_copy"}</span>
      {copied ? "Copied" : label}
    </button>
  );
}
