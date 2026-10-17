"use client";

import { useState } from "react";

type Result = { match: false } | { match: true; document: string; completedAt: string | null; signers: number };

export function VerifyClient({ id }: { id: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check(file: File | null) {
    setResult(null);
    setError(null);
    if (!file) return;
    setBusy(true);
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      const res = await fetch(`/api/verify/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sha256 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? "The check did not go through.");
      setResult(data as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The check did not go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <input type="file" accept="application/pdf,.pdf" onChange={(e) => check(e.target.files?.[0] ?? null)} className="block w-full text-sm" aria-label="Signed PDF" />
      {busy && <p className="text-gray-600">Checking…</p>}
      {error && <p className="text-red-700">{error}</p>}
      {result?.match && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4" role="status">
          <p className="text-lg font-bold text-emerald-900">✓ Genuine and unchanged</p>
          <p className="text-emerald-900">
            This is exactly the {result.document} that DESMA recorded
            {result.completedAt ? ` when signing finished on ${new Date(result.completedAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}` : ""}, signed by {result.signers}{" "}
            {result.signers === 1 ? "person" : "people"}.
          </p>
        </div>
      )}
      {result && !result.match && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4" role="status">
          <p className="text-lg font-bold text-red-900">✗ Does not match</p>
          <p className="text-red-900">
            This file is not the signed copy DESMA recorded for this agreement. It may have been changed, or it may be a different
            document. Contact DESMA if you need a genuine copy.
          </p>
        </div>
      )}
    </div>
  );
}
