"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { codeFromInput } from "@/lib/esign/otp-input";

/**
 * Send a one-time code, then check it. A correct code reloads into the signing view.
 * `alreadySentTo`: a code is still live from an earlier visit, so start at typing it.
 */
export function OtpStep({
  token,
  channels,
  alreadySentTo = null,
}: {
  token: string;
  channels: Array<{ channel: "email" | "whatsapp"; to: string }>;
  alreadySentTo?: string | null;
}) {
  const router = useRouter();
  const [sentTo, setSentTo] = useState<string | null>(alreadySentTo);
  const [resumed, setResumed] = useState(alreadySentTo !== null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, body: unknown) {
    const res = await fetch(`/api/sign/${token}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message ?? "Something went wrong. Try again.");
    return data;
  }

  async function send(channel: "email" | "whatsapp") {
    setBusy(true);
    setError(null);
    try {
      const { to } = await call("otp", { channel });
      setSentTo(to);
      setResumed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The code could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call("verify", { code });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code did not work.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      {!sentTo ? (
        <>
          <p className="font-semibold">Where should we send your code?</p>
          {channels.map((c) => (
            <button key={c.channel} type="button" onClick={() => send(c.channel)} disabled={busy} className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-50">
              {c.channel === "email" ? "Email" : "WhatsApp"} <span className="text-gray-600">{c.to}</span>
            </button>
          ))}
        </>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          {resumed ? (
            <p>
              We already sent a 6-digit code to <b>{sentTo}</b>. Type it below; there is no need to ask for another.
            </p>
          ) : (
            <p>
              We sent a 6-digit code to <b>{sentTo}</b>. It works for 10 minutes.
            </p>
          )}
          <input
            value={code}
            onChange={(e) => setCode(codeFromInput(e.target.value))}
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-2xl tracking-[0.5em]"
            aria-label="One-time code"
            autoFocus
          />
          <button type="submit" disabled={busy || code.length !== 6} className="w-full rounded-lg bg-[#F5C518] py-3 font-bold text-[#1A1A1A] disabled:opacity-40">
            {busy ? "Checking…" : "Continue"}
          </button>
          <p className="text-sm text-gray-600">Asked more than once? A code from any of our messages in the last 10 minutes works.</p>
          <button type="button" onClick={() => { setSentTo(null); setCode(""); setError(null); }} className="text-sm text-gray-600 underline">
            Send a new code
          </button>
        </form>
      )}
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
