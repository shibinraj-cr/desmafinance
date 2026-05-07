"use client";

import Image from "next/image";
import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";

type StepStatus = "idle" | "running" | "ok" | "fail";
type Steps = { click: StepStatus; auth: StepStatus; redirect: StepStatus };

export default function LoginPage() {
  const [callbackUrl, setCallbackUrl] = useState("/overview");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Steps>({ click: "idle", auth: "idle", redirect: "idle" });

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
    setSteps({ click: "ok", auth: "running", redirect: "idle" });

    let res;
    try {
      res = await signIn("credentials", {
        username,
        password,
        redirect: false,
        callbackUrl,
      });
    } catch (e) {
      setBusy(false);
      setSteps((s) => ({ ...s, auth: "fail" }));
      setError(
        "Connection problem (fetch threw). Disable any VPN or privacy extensions and retry. " +
          (e instanceof Error ? `Detail: ${e.message}` : ""),
      );
      return;
    }

    if (res?.error) {
      setBusy(false);
      setSteps((s) => ({ ...s, auth: "fail" }));
      setError("Invalid username or password.");
      return;
    }

    if (!res?.ok) {
      setBusy(false);
      setSteps((s) => ({ ...s, auth: "fail" }));
      setError(
        "Sign-in service did not respond. Try a hard refresh (⌘⇧R), Incognito, or a different browser.",
      );
      return;
    }

    setSteps({ click: "ok", auth: "ok", redirect: "running" });
    // Hard navigation is more reliable than the client-side router here —
    // it forces the browser to re-fetch with the freshly-set session cookie
    // and run the middleware against it from a clean state.
    const target = res.url ?? callbackUrl;
    if (typeof window !== "undefined") {
      window.location.href = target;
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
            <label htmlFor="login-username" className="text-label-sm text-on-surface-variant block mb-xs">
              Username
            </label>
            <input
              id="login-username"
              name="username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full h-11 px-md rounded-lg border border-outline-variant focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
              required
            />
          </div>
          <div>
            <label htmlFor="login-password" className="text-label-sm text-on-surface-variant block mb-xs">
              Password
            </label>
            <input
              id="login-password"
              name="password"
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
          {(busy || steps.click !== "idle") && (
            <div className="rounded-lg bg-surface-container-low border border-outline-variant px-md py-sm text-caption text-on-surface-variant">
              <Step label="Submit clicked" status={steps.click} />
              <Step label="Authenticating" status={steps.auth} />
              <Step label="Redirecting" status={steps.redirect} />
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

function Step({ label, status }: { label: string; status: StepStatus }) {
  const icon =
    status === "ok"
      ? "✓"
      : status === "fail"
        ? "✕"
        : status === "running"
          ? "…"
          : "·";
  const cls =
    status === "ok"
      ? "text-green-700"
      : status === "fail"
        ? "text-error"
        : status === "running"
          ? "text-accent"
          : "text-on-surface-variant";
  return (
    <div className="flex items-center gap-xs font-mono">
      <span className={cls + " w-4 inline-block"}>{icon}</span>
      <span>{label}</span>
    </div>
  );
}
