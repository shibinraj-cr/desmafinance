"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const callbackUrl = search.get("callbackUrl") || "/overview";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await signIn("credentials", {
      username,
      password,
      redirect: false,
      callbackUrl,
    });
    setBusy(false);
    if (res?.error) setError("Invalid username or password.");
    else if (res?.ok) router.replace(callbackUrl);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-surface px-md">
      <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-xl">
        <div className="flex items-center gap-sm mb-lg">
          <div className="w-10 h-10 bg-primary flex items-center justify-center rounded-lg">
            <span className="material-symbols-outlined text-on-primary">account_balance</span>
          </div>
          <div>
            <h1 className="text-h3 text-primary font-bold">Desma Finance</h1>
            <p className="text-label-sm text-on-surface-variant">International Registry</p>
          </div>
        </div>
        <h2 className="text-h2 mb-base">Sign in</h2>
        <p className="text-body-md text-on-surface-variant mb-lg">
          Enter your credentials to access the dashboard.
        </p>
        <form onSubmit={onSubmit} className="space-y-md">
          <div>
            <label className="text-label-sm text-on-surface-variant block mb-xs">Username</label>
            <input
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full h-11 px-md rounded-lg border border-outline-variant focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
              required
            />
          </div>
          <div>
            <label className="text-label-sm text-on-surface-variant block mb-xs">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 px-md rounded-lg border border-outline-variant focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
              required
            />
          </div>
          {error && (
            <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-body-md">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-lg text-caption text-on-surface-variant">
          Need access? Contact your finance admin.
        </p>
      </div>
    </main>
  );
}
