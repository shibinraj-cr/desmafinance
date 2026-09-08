"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The address candidate-facing email comes from.
 *
 * Separate from the global sender because the rest of Desgro — payslips,
 * finance, CRM — should not move just because hiring wants to be hr@.
 */
export function HiringSenderSetting({
  address,
  name,
  globalAddress,
}: {
  address: string | null;
  name: string | null;
  globalAddress: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(address ?? "");
  const [display, setDisplay] = useState(name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(nextAddress: string, nextName: string) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/hiring/email-sender", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: nextAddress, name: nextName }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "That didn't save.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  const effective = address ?? globalAddress;

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
      <div>
        <h3 className="text-h3 text-on-surface">Candidate email sender</h3>
        <p className="text-body-sm text-on-surface-variant max-w-prose">
          The From address on application acknowledgements and hiring automations. Only hiring mail
          moves — payslips, finance and CRM keep sending from{" "}
          <code className="text-caption">{globalAddress ?? "the shared account"}</code>.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-sm text-on-error-container">
          {error}
        </div>
      )}
      {saved && !error && <p className="text-body-sm text-on-surface-variant">Saved.</p>}

      <div className="grid gap-md sm:grid-cols-2 max-w-xl">
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">From address</span>
          <input
            className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
            inputMode="email"
            placeholder="hr@desma.in"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">
            Display name <span className="opacity-70">(optional)</span>
          </span>
          <input
            className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
            placeholder="DESMA International"
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-sm">
        <button
          type="button"
          className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold transition hover:bg-primary-container disabled:opacity-60"
          disabled={busy || (value.trim() === (address ?? "") && display.trim() === (name ?? ""))}
          onClick={() => save(value.trim(), display.trim())}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {address && (
          <button
            type="button"
            className="h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60"
            disabled={busy}
            onClick={() => {
              setValue("");
              setDisplay("");
              void save("", "");
            }}
          >
            Use the shared address
          </button>
        )}
      </div>

      <div className="text-body-sm text-on-surface-variant border-t border-outline-variant pt-sm space-y-xs max-w-prose">
        <p>
          Candidates currently see <strong className="text-on-surface">{effective ?? "—"}</strong>.
        </p>
        {/* The failure mode is silent, so it is worth stating up front rather
            than leaving somebody to wonder why nothing changed. */}
        <p>
          <strong className="text-on-surface">Before this works:</strong> Gmail and Workspace only
          send from an address the logged-in account owns or has verified under{" "}
          <em>Settings → Accounts → Send mail as</em>. Without that, Google quietly rewrites the
          From back to the login address. Replies are not restricted this way — Reply-To is set to
          this address regardless, so a candidate hitting Reply always reaches the right inbox.
        </p>
      </div>
    </section>
  );
}
