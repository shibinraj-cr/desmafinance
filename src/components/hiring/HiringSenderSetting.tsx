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
  smtpUser,
  smtpPassSet,
}: {
  address: string | null;
  name: string | null;
  globalAddress: string | null;
  smtpUser: string | null;
  smtpPassSet: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(address ?? "");
  const [display, setDisplay] = useState(name ?? "");
  const [login, setLogin] = useState(smtpUser ?? "");
  const [appPass, setAppPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tested, setTested] = useState<{ to: string; from: string } | null>(null);

  async function save(nextAddress: string, nextName: string) {
    setBusy(true);
    setError(null);
    setSaved(false);
    setTested(null);
    const res = await fetch("/api/hiring/email-sender", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: nextAddress,
        name: nextName,
        smtpUser: login.trim(),
        // Blank means "leave the stored password alone", not "clear it".
        ...(appPass ? { smtpPass: appPass } : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "That didn't save.");
      return;
    }
    setSaved(true);
    setAppPass("");
    router.refresh();
  }

  async function test() {
    setBusy(true);
    setError(null);
    setTested(null);
    const res = await fetch("/api/hiring/email-sender/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    setBusy(false);
    const d = (await res.json().catch(() => ({}))) as {
      message?: string;
      to?: string;
      from?: string;
    };
    if (!res.ok) {
      setError(d.message ?? "The test could not be sent.");
      return;
    }
    setTested({ to: d.to ?? "", from: d.from ?? "" });
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

      <div className="border-t border-outline-variant pt-md space-y-sm">
        <div>
          <h4 className="text-body-lg text-on-surface">Sign in as the hiring mailbox</h4>
          <p className="text-body-sm text-on-surface-variant max-w-prose">
            Optional, and the reliable route. Relabelling mail sent through the shared account only
            works if Google has granted that address to it — which is what{" "}
            <em>Settings → Accounts → Send mail as</em> does, and it is missing or switched off on
            plenty of Workspace accounts. Signing in as{" "}
            <code className="text-caption">hr@</code> avoids the question: the mail genuinely comes
            from there, so there is nothing to verify.
          </p>
        </div>

        <div className="grid gap-md sm:grid-cols-2 max-w-xl">
          <label className="block">
            <span className="block text-label-sm text-on-surface-variant mb-xs">Mailbox login</span>
            <input
              className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
              inputMode="email"
              placeholder="hr@desma.in"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="block text-label-sm text-on-surface-variant mb-xs">
              App password{" "}
              <span className="opacity-70">{smtpPassSet ? "(saved — type to replace)" : "(16 characters)"}</span>
            </span>
            <input
              type="password"
              autoComplete="new-password"
              className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
              placeholder={smtpPassSet ? "••••••••••••••••" : "abcd efgh ijkl mnop"}
              value={appPass}
              onChange={(e) => setAppPass(e.target.value)}
            />
          </label>
        </div>

        <p className="text-body-sm text-on-surface-variant max-w-prose">
          Not the account password — a Google{" "}
          <strong className="text-on-surface">App Password</strong>, generated at{" "}
          <code className="text-caption">myaccount.google.com/apppasswords</code> while signed in as
          that mailbox, with 2-Step Verification on. Leave both blank to keep using the shared
          account.
        </p>
      </div>

      <div className="border-t border-outline-variant pt-md space-y-xs">
        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="button"
            className="h-10 px-lg rounded-lg border border-outline-variant text-on-surface hover:bg-surface-container-low disabled:opacity-60"
            disabled={busy}
            onClick={() => void test()}
          >
            {busy ? "Sending…" : "Send a test email"}
          </button>
          <span className="text-body-sm text-on-surface-variant">
            Candidates currently see <strong className="text-on-surface">{effective ?? "—"}</strong>.
          </span>
        </div>

        {tested && (
          <div className="rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm text-body-sm text-on-surface-variant">
            Sent to <strong className="text-on-surface">{tested.to}</strong>, asking to send as{" "}
            <strong className="text-on-surface">{tested.from}</strong>.{" "}
            {/* The whole point of the test: Google accepts the send and rewrites
                the header, so only the delivered message tells the truth. */}
            Open it and check the From line — if it shows a different address, Google rewrote it and
            that mailbox has not been granted to the sending account.
          </div>
        )}
      </div>
    </section>
  );
}
