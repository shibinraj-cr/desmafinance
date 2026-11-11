"use client";

import { useEffect, useRef, useState } from "react";
import { QUALIFICATION_OTHER_MAX } from "@/lib/crm";

/**
 * The public referral form. Five questions and a tick box, built for a phone at
 * 390px: one native <form>, real labels, real `required`s, and a submit that
 * says exactly what went wrong. Colours come from the `.careers-theme` scope.
 */

type Opt = { id: string; label: string };
type QualOpt = Opt & { isOther: boolean };

const inputCls = "w-full min-h-[44px] px-md py-sm rounded-lg text-body-md";
/** "Not sure yet" in the service list — sent as no service at all. */
const UNSURE = "unsure";

export function ReferralForm({ code, qualifications, services }: { code: string; qualifications: QualOpt[]; services: Opt[] }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [qualificationId, setQualificationId] = useState("");
  const [firstName, setFirstName] = useState("");
  // The form's own dwell time — a script posts instantly, a person does not.
  const mountedAt = useRef(Date.now());

  // Count this page open once per browser session. Sent from here, not the
  // server render, so WhatsApp fetching the link for its preview isn't a visit.
  useEffect(() => {
    const key = `desma-ref-visit:${code}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage blocked (private mode): count it anyway, once per page load.
    }
    fetch(`/api/referral/${encodeURIComponent(code)}/visit`, { method: "POST", keepalive: true }).catch(() => {});
  }, [code]);

  const isOther = qualifications.find((q) => q.id === qualificationId)?.isOther ?? false;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState("sending");

    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();
    const service = text("serviceId");
    const name = text("name");
    const body = {
      name,
      phone: text("phone"),
      email: text("email"),
      qualificationId: text("qualificationId"),
      qualificationOther: isOther ? text("qualificationOther") : "",
      serviceId: service === UNSURE ? "" : service,
      consent: f.get("consent") === "true",
      website: text("website"),
      dwellMs: Date.now() - mountedAt.current,
    };

    try {
      const res = await fetch(`/api/referral/${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setFirstName(name.split(/\s+/)[0] ?? "");
        setState("sent");
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        issues?: { message: string }[];
      };
      setState("idle");
      setError(
        payload.message ||
          payload.issues?.[0]?.message ||
          (payload.error === "rate_limited"
            ? "Too many forms from this connection. Please try again shortly."
            : "Something went wrong sending your details. Please try again."),
      );
    } catch {
      setState("idle");
      setError("We could not reach the server. Check your connection and try again.");
    }
  }

  if (state === "sent") {
    return (
      <div role="status" className="space-y-xs">
        <h2 className="text-h3 careers-ink">Thank you{firstName ? `, ${firstName}` : ""}!</h2>
        <p className="text-body-md careers-muted">
          We have your details. Someone from the DESMA team will contact you on WhatsApp soon.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-lg">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container"
        >
          {error}
        </div>
      )}

      <fieldset disabled={state === "sending"}>
        <legend className="sr-only">Your details</legend>
        <div className="space-y-md">
          <Field label="Your name" htmlFor="name" required>
            <input id="name" name="name" required minLength={2} maxLength={120} autoComplete="name" className={inputCls} />
          </Field>

          <Field
            label="WhatsApp number"
            htmlFor="phone"
            required
            hint="With the country code if you're outside India, e.g. +971 50 123 4567."
          >
            <input id="phone" name="phone" type="tel" required maxLength={30} autoComplete="tel" className={inputCls} />
          </Field>

          <Field label="Email" htmlFor="email" hint="Optional.">
            <input id="email" name="email" type="email" maxLength={200} autoComplete="email" className={inputCls} />
          </Field>

          <Field label="Your qualification" htmlFor="qualificationId" required>
            <select
              id="qualificationId"
              name="qualificationId"
              required
              value={qualificationId}
              onChange={(e) => setQualificationId(e.target.value)}
              className={inputCls}
            >
              <option value="">Choose one…</option>
              {qualifications.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
          </Field>

          {isOther && (
            <Field label="Which qualification?" htmlFor="qualificationOther" required>
              <input
                id="qualificationOther"
                name="qualificationOther"
                required
                maxLength={QUALIFICATION_OTHER_MAX}
                placeholder="e.g. MSc"
                className={inputCls}
              />
            </Field>
          )}

          <Field label="What are you interested in?" htmlFor="serviceId" required>
            <select id="serviceId" name="serviceId" required defaultValue="" className={inputCls}>
              <option value="">Choose one…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
              <option value={UNSURE}>Not sure yet</option>
            </select>
          </Field>
        </div>
      </fieldset>

      <div className="space-y-md">
        <label className="flex items-start gap-sm text-body-md careers-muted">
          <input
            type="checkbox"
            name="consent"
            value="true"
            required
            disabled={state === "sending"}
            className="mt-xs h-4 w-4 flex-shrink-0 accent-[color:var(--careers-grey)]"
          />
          <span>
            I agree that DESMA International may contact me on WhatsApp, by phone or by email about its services, and
            store these details as described in its{" "}
            <a className="underline" href="/privacy-policy" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>{" "}
            and{" "}
            <a className="underline" href="/terms" target="_blank" rel="noopener noreferrer">
              Terms
            </a>
            .
          </span>
        </label>

        <button type="submit" disabled={state === "sending"} className="careers-btn w-full">
          {state === "sending" ? "Sending…" : "Send my details"}
        </button>
      </div>

      {/* Honeypot: off-screen, not display:none (some bots skip those), and
          never announced to screen readers. Last, so the form's spacing
          doesn't open a gap above the first field. */}
      <div aria-hidden className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="website">Leave this field empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-label-sm careers-ink mb-xs">
        {label}
        {required && <span className="text-error"> *</span>}
      </label>
      {children}
      {hint && <p className="text-caption careers-muted mt-xs">{hint}</p>}
    </div>
  );
}
