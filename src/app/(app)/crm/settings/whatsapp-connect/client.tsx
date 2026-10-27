"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  COEXISTENCE_GRAPH_VERSION,
  COEXISTENCE_LOGIN_EXTRAS,
  isFacebookOrigin,
  parseEmbeddedSignupMessage,
  type EmbeddedSignupEvent,
} from "@/lib/wa/embedded-signup";
import type { CoexistenceNumber, CoexistenceStepKey } from "@/lib/wa/coexistence";

/**
 * Embedded Signup launcher for a WhatsApp Business app number.
 *
 * Two things arrive from Meta, in either order: the FB.login callback with a
 * 30-second exchangeable code, and a postMessage naming the account and number
 * that were connected. Only with both can the server finish the job, so each
 * handler records its half and calls `tryComplete`, which fires once.
 */

type FbLoginResponse = { authResponse?: { code?: string } | null; status?: string };
type FacebookSdk = {
  init(options: Record<string, unknown>): void;
  login(callback: (response: FbLoginResponse) => void, options: Record<string, unknown>): void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

type ConnectState = {
  appId: string;
  configId: string;
  hasAppSecret: boolean;
  cloudConfigured: boolean;
  redirectUri: string;
  numbers: CoexistenceNumber[];
};

type Phase = "idle" | "popup" | "finishing" | "done" | "error";

const STEP_LABELS: Record<CoexistenceStepKey, string> = {
  token: "Access",
  subscribe: "Messages routed to DesGro",
  contacts: "Contacts sync",
  history: "Chat history sync",
  verify: "Read back from Meta",
};

const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
/** How long to wait for the account IDs after the popup closes with a code. */
const SESSION_WAIT_MS = 8_000;

const card = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm";
const btn = "h-9 px-md rounded-lg text-label-sm font-semibold transition disabled:opacity-60";
const primary = btn + " bg-primary text-on-primary hover:bg-primary-container";
const ghost = btn + " border border-outline-variant text-on-surface-variant hover:bg-surface-container-low";
const input =
  "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
      {hint && <span className="block text-label-sm text-on-surface-variant mt-xs">{hint}</span>}
    </label>
  );
}

export function ConnectClient() {
  const [state, setState] = useState<ConnectState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [appId, setAppId] = useState("");
  const [configId, setConfigId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<CoexistenceNumber | null>(null);

  const [manualWaba, setManualWaba] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  const sessionRef = useRef<Extract<EmbeddedSignupEvent, { kind: "finish" }> | null>(null);
  const codeRef = useRef<string | null>(null);
  const loginReturnedRef = useRef(false);
  const doneRef = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/crm/wa/connect", { cache: "no-store" });
    if (!res.ok) {
      setLoadError("Could not load the connection settings.");
      return;
    }
    const s = (await res.json()) as ConnectState;
    setState(s);
    setAppId((cur) => cur || s.appId);
    setConfigId((cur) => cur || s.configId);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Load and initialise the SDK once an app id is saved. Re-initialising on a
  // changed id is allowed by the SDK and is what a corrected id needs.
  const savedAppId = state?.appId ?? "";
  useEffect(() => {
    if (!savedAppId) return;
    const init = () => {
      window.FB?.init({ appId: savedAppId, autoLogAppEvents: false, xfbml: false, version: COEXISTENCE_GRAPH_VERSION });
      setSdkReady(true);
    };
    if (window.FB) {
      init();
      return;
    }
    window.fbAsyncInit = init;
    if (!document.getElementById("facebook-jssdk")) {
      const s = document.createElement("script");
      s.id = "facebook-jssdk";
      s.src = SDK_SRC;
      s.async = true;
      s.defer = true;
      s.crossOrigin = "anonymous";
      s.onerror = () => setSdkError("Facebook's sign-in script did not load — an ad blocker or privacy extension is the usual cause.");
      document.body.appendChild(s);
    }
  }, [savedAppId]);

  const runComplete = useCallback(
    async (body: { code: string | null; wabaId: string; phoneNumberId: string; event: string | null }) => {
      setPhase("finishing");
      setStatus("Connected in Meta — routing its messages to DesGro…");
      const res = await fetch("/api/crm/wa/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          ...(body.code ? { code: body.code } : {}),
          wabaId: body.wabaId,
          phoneNumberId: body.phoneNumberId,
          ...(body.event ? { event: body.event } : {}),
        }),
      });
      const p = (await res.json().catch(() => ({}))) as { ok?: boolean; number?: CoexistenceNumber; message?: string };
      if (p.number) setLastRun(p.number);
      if (res.ok && p.ok) {
        setPhase("done");
        setStatus("Done. New messages to this number will now reach the CRM — send a test message from a number that isn't a lead yet.");
      } else {
        setPhase("error");
        setStatus(
          p.number
            ? "Meta connected the number, but DesGro could not finish routing its messages — see the failed step below and run the follow-up steps again."
            : (p.message ?? "The follow-up steps failed."),
        );
      }
      void load();
    },
    [load],
  );

  const tryComplete = useCallback(() => {
    const session = sessionRef.current;
    if (!session || doneRef.current) return;
    // The login callback carries the code; give it the chance to land first.
    if (!codeRef.current && !loginReturnedRef.current) return;
    doneRef.current = true;
    if (!session.wabaId || !session.phoneNumberId) {
      setPhase("error");
      setStatus(
        "Meta finished without saying which account and number were connected. Copy both IDs from WhatsApp Manager into “Run the follow-up steps” below.",
      );
      return;
    }
    void runComplete({
      code: codeRef.current,
      wabaId: session.wabaId,
      phoneNumberId: session.phoneNumberId,
      event: session.event,
    });
  }, [runComplete]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!isFacebookOrigin(e.origin)) return;
      const parsed = parseEmbeddedSignupMessage(e.data);
      if (!parsed) return;
      if (parsed.kind === "finish") {
        sessionRef.current = parsed;
        tryComplete();
      } else if (parsed.kind === "cancel") {
        if (doneRef.current) return;
        setPhase("idle");
        setStatus(
          `Signup was closed${parsed.currentStep ? ` at “${parsed.currentStep}”` : ""}${parsed.errorMessage ? ` — ${parsed.errorMessage}` : ""}. Nothing was changed.`,
        );
      } else {
        setPhase("error");
        setStatus(`Meta reported an error${parsed.errorMessage ? `: ${parsed.errorMessage}` : ""}${parsed.errorCode ? ` (${parsed.errorCode})` : ""}.`);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [tryComplete]);

  function launch() {
    if (!window.FB || !state?.configId) return;
    sessionRef.current = null;
    codeRef.current = null;
    loginReturnedRef.current = false;
    doneRef.current = false;
    setLastRun(null);
    setPhase("popup");
    setStatus("Finish the steps in Meta’s window. Keep the phone with the WhatsApp Business app nearby.");

    // FB.login rejects an async callback, so this stays synchronous.
    window.FB.login(
      (response) => {
        loginReturnedRef.current = true;
        codeRef.current = response.authResponse?.code ?? null;
        tryComplete();
        if (!doneRef.current) {
          window.setTimeout(() => {
            if (doneRef.current) return;
            if (!sessionRef.current) {
              setPhase(codeRef.current ? "error" : "idle");
              setStatus(
                codeRef.current
                  ? "Meta finished but didn’t say which number was connected. Copy the WhatsApp Business Account ID and phone number ID from WhatsApp Manager into “Run the follow-up steps” below."
                  : "Signup was closed before it finished. Nothing was changed.",
              );
            }
          }, SESSION_WAIT_MS);
        }
      },
      {
        config_id: state.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: COEXISTENCE_LOGIN_EXTRAS,
      },
    );
  }

  async function saveConfig() {
    setSaving(true);
    setSaveNote(null);
    const res = await fetch("/api/crm/wa/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "save_config", appId: appId.trim(), configId: configId.trim() }),
    });
    setSaving(false);
    setSaveNote(res.ok ? "Saved." : "Both must be the numeric IDs from Meta's App Dashboard.");
    if (res.ok) void load();
  }

  if (loadError) return <div className={card + " p-lg text-error"}>{loadError}</div>;
  if (!state) return <div className={card + " p-lg text-on-surface-variant"}>Loading…</div>;

  const missing: string[] = [];
  if (!state.appId) missing.push("the Meta app ID");
  if (!state.configId) missing.push("the Embedded Signup configuration ID");
  if (!state.hasAppSecret) missing.push("the App secret (WhatsApp Cloud API card in CRM Settings)");
  if (!state.cloudConfigured) missing.push("the Cloud API access token (WhatsApp Cloud API card in CRM Settings)");
  const busy = phase === "popup" || phase === "finishing";
  const canLaunch = missing.length === 0 && sdkReady && !busy;

  return (
    <div className="space-y-lg">
      <div className={card + " p-lg space-y-md"}>
        <h3 className="text-h3 text-on-surface">Connect a WhatsApp Business app number</h3>
        <p className="text-label-sm text-on-surface-variant">
          Links a number that runs on the WhatsApp Business app on a phone to the CRM, without taking it off the phone
          (Meta calls this Coexistence). The team keeps chatting in the app; every message to the number also reaches
          the CRM, and a number we have never seen becomes a new lead.
        </p>
        <ol className="list-decimal pl-lg space-y-xs text-label-sm text-on-surface">
          <li>
            Use a laptop, with the phone that holds the number nearby (WhatsApp Business 2.24.17 or newer).
          </li>
          <li>
            In Meta’s window, pick our existing business portfolio and choose{" "}
            <span className="font-semibold">Connect your existing WhatsApp Business app</span>.
          </li>
          <li>
            On the phone, open the message from Facebook Business → <span className="font-semibold">Connect</span> →{" "}
            <span className="font-semibold">Connect to the Business Platform</span>, and choose{" "}
            <span className="font-semibold">Don’t share chats</span>.
          </li>
        </ol>
        <div className="rounded-lg border border-error/40 bg-error/5 p-md">
          <p className="text-label-sm text-error font-semibold">
            If Meta only offers to add or verify a new number by SMS or call, close the window.
          </p>
          <p className="text-label-sm text-on-surface-variant">
            That is ordinary registration, and it would move the number off the WhatsApp Business app — the chats on the
            phone would stop working.
          </p>
        </div>

        {missing.length > 0 && (
          <p className="text-label-sm text-error">Before connecting, set {missing.join(", ")}.</p>
        )}
        {sdkError && <p className="text-label-sm text-error">{sdkError}</p>}

        <div className="flex flex-wrap items-center gap-base">
          <button type="button" className={primary} disabled={!canLaunch} onClick={launch}>
            {phase === "popup" ? "Waiting for Meta…" : phase === "finishing" ? "Finishing…" : "Connect WhatsApp number"}
          </button>
          {state.appId && !sdkReady && !sdkError && (
            <span className="text-label-sm text-on-surface-variant">Loading Facebook sign-in…</span>
          )}
        </div>
        {status && (
          <p className={"text-label-sm " + (phase === "error" ? "text-error" : phase === "done" ? "text-primary" : "text-on-surface-variant")}>
            {status}
          </p>
        )}
        {lastRun && <StepList number={lastRun} />}
      </div>

      <div className={card + " p-lg space-y-md"}>
        <h3 className="text-h3 text-on-surface">Connected numbers</h3>
        {state.numbers.length === 0 ? (
          <p className="text-label-sm text-on-surface-variant">None yet.</p>
        ) : (
          <ul className="space-y-md">
            {state.numbers.map((n) => (
              <li key={n.phoneNumberId} className="rounded-lg border border-outline-variant p-md space-y-sm">
                <div className="flex flex-wrap items-center justify-between gap-sm">
                  <div>
                    <span className="block text-body-md text-on-surface font-semibold">
                      {n.displayPhone ?? n.phoneNumberId}
                      {n.verifiedName ? ` — ${n.verifiedName}` : ""}
                    </span>
                    <span className="block text-label-sm text-on-surface-variant font-mono">
                      account {n.wabaId} · number {n.phoneNumberId}
                    </span>
                  </div>
                  <span
                    className={
                      "text-label-sm font-semibold " + (n.onBizApp === true ? "text-primary" : "text-on-surface-variant")
                    }
                  >
                    {n.onBizApp === true
                      ? "On the Business app and the API"
                      : n.onBizApp === false
                        ? "Not on the Business app"
                        : "Status unknown"}
                  </span>
                </div>
                <StepList number={n} />
                <div className="flex flex-wrap items-center gap-base">
                  <span className="text-label-sm text-on-surface-variant">
                    Last run {new Date(n.lastRunAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    className={ghost}
                    disabled={busy}
                    onClick={() => void runComplete({ code: null, wabaId: n.wabaId, phoneNumberId: n.phoneNumberId, event: n.event })}
                  >
                    Run the follow-up steps again
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-label-sm text-on-surface-variant">
          Contacts and chat history can each be synced only once, within 24 hours of connecting — on a re-run those two
          failing is expected. “Messages routed to DesGro” is the one that matters.
        </p>
      </div>

      <div className={card + " p-lg space-y-md"}>
        <h3 className="text-h3 text-on-surface">Meta app setup</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-base">
          <Field label="Meta app ID" hint="App Dashboard → App settings → Basic.">
            <input value={appId} onChange={(e) => setAppId(e.target.value)} className={input + " w-full font-mono text-label-sm"} />
          </Field>
          <Field
            label="Embedded Signup configuration ID"
            hint="Facebook Login for Business → Configurations — the one made from the “WhatsApp embedded sign-up” template."
          >
            <input value={configId} onChange={(e) => setConfigId(e.target.value)} className={input + " w-full font-mono text-label-sm"} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-base">
          <button type="button" className={primary} disabled={saving} onClick={() => void saveConfig()}>
            {saving ? "Saving…" : "Save"}
          </button>
          {saveNote && <span className="text-label-sm text-on-surface-variant">{saveNote}</span>}
        </div>
        <Field label="Valid OAuth Redirect URI — must be listed in Facebook Login for Business → Settings">
          <code className="block px-md py-sm rounded-lg bg-surface-container-low text-label-sm font-mono break-all">
            {state.redirectUri}
          </code>
        </Field>
        <p className="text-label-sm text-on-surface-variant">
          The same settings page also needs “Login with the JavaScript SDK” on, and this site’s address under “Allowed
          Domains for the JavaScript SDK”.
        </p>

        <details className="pt-md border-t border-outline-variant">
          <summary className="cursor-pointer text-label-sm text-on-surface font-semibold">Run the follow-up steps</summary>
          <p className="text-label-sm text-on-surface-variant mt-sm">
            For a number already connected in Meta whose follow-up didn’t finish here. Both IDs are in WhatsApp Manager.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-base mt-sm">
            <Field label="WhatsApp Business Account ID">
              <input value={manualWaba} onChange={(e) => setManualWaba(e.target.value)} className={input + " w-full font-mono text-label-sm"} />
            </Field>
            <Field label="Phone number ID" hint="The number’s id, not the number itself.">
              <input value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} className={input + " w-full font-mono text-label-sm"} />
            </Field>
          </div>
          <button
            type="button"
            className={ghost + " mt-sm"}
            disabled={busy || !manualWaba.trim() || !manualPhone.trim()}
            onClick={() => void runComplete({ code: null, wabaId: manualWaba.trim(), phoneNumberId: manualPhone.trim(), event: null })}
          >
            Run follow-up steps
          </button>
        </details>
      </div>

      <Link href="/crm/settings" className="inline-block text-label-sm text-primary hover:underline">
        ← Back to CRM Settings
      </Link>
    </div>
  );
}

function StepList({ number }: { number: CoexistenceNumber }) {
  if (number.steps.length === 0) return null;
  return (
    <ul className="space-y-xs">
      {number.steps.map((s) => (
        <li key={s.key} className="text-label-sm">
          <span className={s.ok ? "text-primary font-semibold" : "text-error font-semibold"}>{s.ok ? "✓" : "✕"}</span>{" "}
          <span className="text-on-surface">{STEP_LABELS[s.key]}</span>{" "}
          <span className="text-on-surface-variant break-all">— {s.detail}</span>
        </li>
      ))}
    </ul>
  );
}
