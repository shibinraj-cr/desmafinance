"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type StepStatus = "idle" | "running" | "ok" | "fail";
type Steps = {
  click: StepStatus;
  csrf: StepStatus;
  post: StepStatus;
  parse: StepStatus;
  redirect: StepStatus;
};

const INITIAL_STEPS: Steps = {
  click: "idle",
  csrf: "idle",
  post: "idle",
  parse: "idle",
  redirect: "idle",
};

async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export default function LoginPage() {
  const [callbackUrl, setCallbackUrl] = useState("/overview");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Steps>(INITIAL_STEPS);

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
    setSteps({ ...INITIAL_STEPS, click: "ok", csrf: "running" });

    // 1 — CSRF token
    let csrfToken: string;
    try {
      const r = await fetchWithTimeout(
        "/api/auth/csrf",
        { credentials: "include", cache: "no-store" },
        15000,
      );
      if (!r.ok) {
        setBusy(false);
        setSteps((s) => ({ ...s, csrf: "fail" }));
        setError(`CSRF endpoint returned ${r.status}.`);
        return;
      }
      const j = await r.json();
      csrfToken = j.csrfToken;
      if (!csrfToken) {
        setBusy(false);
        setSteps((s) => ({ ...s, csrf: "fail" }));
        setError("CSRF token missing from response.");
        return;
      }
      setSteps((s) => ({ ...s, csrf: "ok", post: "running" }));
    } catch (err) {
      setBusy(false);
      setSteps((s) => ({ ...s, csrf: "fail" }));
      setError(
        "Could not fetch CSRF token. " +
          (err instanceof Error ? err.message : String(err)),
      );
      return;
    }

    // 2 — POST credentials
    let postRes: Response;
    try {
      const body = new URLSearchParams();
      body.set("csrfToken", csrfToken);
      body.set("username", username);
      body.set("password", password);
      body.set("callbackUrl", callbackUrl);
      body.set("json", "true");
      postRes = await fetchWithTimeout(
        "/api/auth/callback/credentials",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          credentials: "include",
          cache: "no-store",
        },
        20000,
      );
      setSteps((s) => ({ ...s, post: "ok", parse: "running" }));
    } catch (err) {
      setBusy(false);
      setSteps((s) => ({ ...s, post: "fail" }));
      setError(
        "Login request failed before reaching the server. " +
          (err instanceof Error ? err.message : String(err)),
      );
      return;
    }

    // 3 — Parse response
    let resultUrl: string | null = null;
    try {
      const text = await postRes.text();
      if (postRes.status === 401) {
        setBusy(false);
        setSteps((s) => ({ ...s, parse: "fail" }));
        setError("Invalid username or password.");
        return;
      }
      if (!postRes.ok) {
        setBusy(false);
        setSteps((s) => ({ ...s, parse: "fail" }));
        setError(`Server returned HTTP ${postRes.status}.`);
        return;
      }
      try {
        const j = JSON.parse(text);
        resultUrl = j.url ?? null;
      } catch {
        // Server may have returned a redirect-style response with no JSON.
        resultUrl = null;
      }
      setSteps((s) => ({ ...s, parse: "ok", redirect: "running" }));
    } catch (err) {
      setBusy(false);
      setSteps((s) => ({ ...s, parse: "fail" }));
      setError(
        "Could not read server response. " +
          (err instanceof Error ? err.message : String(err)),
      );
      return;
    }

    if (resultUrl && resultUrl.includes("error=")) {
      setBusy(false);
      setSteps((s) => ({ ...s, redirect: "fail" }));
      setError("Invalid username or password.");
      return;
    }

    // 4 — Redirect
    if (typeof window !== "undefined") {
      window.location.href = resultUrl ?? callbackUrl;
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
            <label
              htmlFor="login-username"
              className="text-label-sm text-on-surface-variant block mb-xs"
            >
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
            <label
              htmlFor="login-password"
              className="text-label-sm text-on-surface-variant block mb-xs"
            >
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
            <div className="rounded-lg bg-surface-container-low border border-outline-variant px-md py-sm text-caption">
              <Step label="Submit clicked" status={steps.click} />
              <Step label="Fetched CSRF token" status={steps.csrf} />
              <Step label="POSTed credentials" status={steps.post} />
              <Step label="Parsed response" status={steps.parse} />
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
      <span className="text-on-surface-variant">{label}</span>
    </div>
  );
}
