"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * The state transitions on a requisition: publish, pause, close, and the
 * approve/reject pair when it is routed for approval.
 *
 * Publishing a req that is not ready is not an error — the server answers with
 * the list of reasons, and they are shown here as a checklist rather than a
 * red toast, because every one of them is a thing the recruiter can go fix.
 */
export function JobActions({
  jobId,
  status,
  slug,
  approvalRequired,
  blockers,
  canWrite,
  canApprove,
}: {
  jobId: string;
  status: string;
  slug: string;
  approvalRequired: boolean;
  blockers: string[];
  canWrite: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishBlockers, setPublishBlockers] = useState<string[] | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeReason, setCloseReason] = useState("");

  const primaryBtn =
    "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
  const secondaryBtn =
    "h-10 px-md rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";

  async function call(label: string, url: string, body?: unknown) {
    setBusy(label);
    setError(null);
    setPublishBlockers(null);
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(null);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "That didn't work.");
      return null;
    }
    const data = await res.json().catch(() => ({}));
    router.refresh();
    return data as { outcome?: { published: boolean; status: string; blockers?: string[] } };
  }

  async function publish() {
    const data = await call("publish", `/api/hiring/jobs/${jobId}/publish`);
    if (data?.outcome && !data.outcome.published && data.outcome.blockers?.length) {
      setPublishBlockers(data.outcome.blockers);
    }
  }

  return (
    <div className="space-y-md">
      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}

      {(publishBlockers ?? (status === "draft" && blockers.length ? blockers : null)) && (
        <div className="rounded-xl border border-outline-variant bg-primary-fixed/40 p-md">
          <div className="text-body-md text-on-surface font-semibold mb-xs">
            Before this can go live
          </div>
          <ul className="list-disc pl-lg space-y-xs text-body-md text-on-surface-variant">
            {(publishBlockers ?? blockers).map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-xs">
        {status === "live" && (
          <Link
            href={`/careers/desma/${slug}`}
            className={secondaryBtn + " inline-flex items-center gap-xs"}
            target="_blank"
          >
            View the public page ↗
          </Link>
        )}

        {canWrite && (status === "draft" || status === "paused") && (
          <button type="button" className={primaryBtn} onClick={publish} disabled={busy !== null}>
            {busy === "publish"
              ? "Publishing…"
              : approvalRequired
                ? "Send for approval"
                : status === "paused"
                  ? "Republish"
                  : "Publish"}
          </button>
        )}

        {canWrite && status === "live" && (
          <button
            type="button"
            className={secondaryBtn}
            onClick={() =>
              fetch(`/api/hiring/jobs/${jobId}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ status: "paused" }),
              }).then(() => router.refresh())
            }
            disabled={busy !== null}
          >
            Pause
          </button>
        )}

        {canApprove && status === "pending_approval" && (
          <>
            <button
              type="button"
              className={primaryBtn}
              onClick={() => call("approve", `/api/hiring/jobs/${jobId}/approve`, { decision: "approve" })}
              disabled={busy !== null}
            >
              {busy === "approve" ? "Approving…" : "Approve and publish"}
            </button>
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => call("reject", `/api/hiring/jobs/${jobId}/approve`, { decision: "reject" })}
              disabled={busy !== null}
            >
              Send back as a draft
            </button>
          </>
        )}

        {canWrite && status !== "closed" && (
          <button type="button" className={secondaryBtn} onClick={() => setClosing((v) => !v)}>
            Close req
          </button>
        )}
      </div>

      {closing && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-low p-md">
          <label className="block">
            <span className="block text-label-sm text-on-surface-variant mb-xs">
              Why is this requisition closing?
            </span>
            <input
              className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              placeholder="Filled internally / budget pulled / role changed"
              maxLength={300}
            />
          </label>
          <p className="text-caption text-on-surface-variant mt-xs">
            The pipeline history is kept — closing a req never deletes its candidates or events.
          </p>
          <div className="mt-sm flex gap-xs">
            <button
              type="button"
              className={primaryBtn}
              disabled={!closeReason.trim() || busy !== null}
              onClick={async () => {
                const ok = await call("close", `/api/hiring/jobs/${jobId}/close`, { reason: closeReason });
                if (ok) setClosing(false);
              }}
            >
              {busy === "close" ? "Closing…" : "Close requisition"}
            </button>
            <button type="button" className={secondaryBtn} onClick={() => setClosing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
