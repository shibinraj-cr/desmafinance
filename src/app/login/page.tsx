"use client";

import Image from "next/image";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [callbackUrl, setCallbackUrl] = useState("/overview");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Read callbackUrl from window.location to avoid useSearchParams' Suspense
  // requirement, which broke SSR rendering of this page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const cb = params.get("callbackUrl");
    if (cb && cb.startsWith("/")) setCallbackUrl(cb);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    let res;
    try {
      res = await signIn("credentials", {
        username,
        password,
        redirect: false,
        callbackUrl,
      });
    } catch {
      setBusy(false);
      setError(
        "Connection problem. Check your internet, disable any VPN or privacy extensions, then try again.",
      );
      return;
    }
    setBusy(false);
    if (res?.error) {
      setError("Invalid username or password.");
    } else if (res?.ok) {
      router.replace(callbackUrl);
    } else {
      setError(
        "Could not reach the sign-in service. Try a hard refresh (⌘⇧R) or an Incognito window.",
      );
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-brand px-md py-lg">
      <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-xl">
        <div className="flex flex-col items-center text-center mb-lg">
          <div className="w-20 h-20 rounded-xl overflow-hidden bg-brand flex items-center justify-center shadow-sm">
            <Image src="/desfin.png" alt="DESFIN" width={80} height={80} priority />
          </div>
          <h1 className="text-h2 font-bold text-on-surface mt-md">DESFIN</h1>
          <p className="text-label-sm text-on-surface-variant uppercase tracking-widest">
            Desma International
          </p>
        </div>
        <h2 className="text-h3 text-on-surface">Sign in</h2>
        <p className="text-body-md text-on-surface-variant mt-xs mb-lg">
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
