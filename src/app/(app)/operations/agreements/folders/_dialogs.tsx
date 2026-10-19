"use client";

import { useState } from "react";
import { Icon, Modal, api, inputCls, primaryBtn } from "../_ui";

export function RowButton({
  icon,
  label,
  onClick,
  href,
  danger = false,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
}) {
  const cls = `p-xs rounded-md hover:bg-surface-container text-on-surface-variant ${
    danger ? "hover:text-error" : "hover:text-on-surface"
  }`;
  if (href) {
    return (
      <a href={href} className={cls} title={label} aria-label={label}>
        <Icon name={icon} size={20} />
      </a>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick} title={label} aria-label={label}>
      <Icon name={icon} size={20} />
    </button>
  );
}

export function NameDialog({
  title,
  initial,
  submitLabel,
  hint,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: string;
  submitLabel: string;
  hint?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="space-y-md"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setSaving(true);
          setError(null);
          try {
            await onSubmit(name);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save");
            setSaving(false);
          }
        }}
      >
        <div className="space-y-xs">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => {
              // Select the name without its extension, like a file manager does.
              const dot = e.target.value.lastIndexOf(".");
              e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
            }}
            maxLength={200}
            className={inputCls}
            aria-label="Name"
          />
          {hint && <p className="text-caption text-on-surface-variant">{hint}</p>}
          {error && <p className="text-caption text-error">{error}</p>}
        </div>
        <div className="flex justify-end gap-sm">
          <button type="button" className="px-md py-sm text-on-surface-variant hover:underline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryBtn} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteDialog({
  title,
  name,
  message,
  blockedReason,
  url,
  onClose,
  onDone,
}: {
  title: string;
  name: string;
  message: string;
  /** When set, nothing can be deleted and this says why. */
  blockedReason?: string | null;
  url: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title={title} subtitle={name} onClose={onClose}>
      <p className="text-body-md text-on-surface-variant">{blockedReason ?? message}</p>
      {error && <p className="text-caption text-error">{error}</p>}
      <div className="flex justify-end gap-sm">
        <button type="button" className="px-md py-sm text-on-surface-variant hover:underline" onClick={onClose}>
          {blockedReason ? "Close" : "Cancel"}
        </button>
        {!blockedReason && (
          <button
            type="button"
            disabled={saving}
            className="inline-flex items-center px-md py-sm bg-error text-white rounded-md text-body-md font-semibold hover:opacity-90 disabled:opacity-50"
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await api(url, "DELETE");
                onDone();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not delete");
                setSaving(false);
              }
            }}
          >
            {saving ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
    </Modal>
  );
}
