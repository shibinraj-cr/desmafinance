import type { Metadata } from "next";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { resolveEnvelope, appendAudit } from "@/lib/hiring/envelope";
import { formatHiringDate } from "@/lib/hiring/core";
import { SignClient } from "./sign-client";

export const dynamic = "force-dynamic";

// An offer letter must never be indexed or previewed anywhere.
export const metadata: Metadata = {
  title: "Your offer — DESMA International",
  robots: { index: false, follow: false, nocache: true },
};

function ip(): string | null {
  const h = headers();
  const fwd = h.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0]!.trim() : h.get("x-real-ip");
}

export default async function OfferPage({ params }: { params: { token: string } }) {
  const resolved = await resolveEnvelope(params.token);

  if (!resolved.envelope) {
    return (
      <Shell title="This link is not valid">
        <p>
          We could not find an offer for this link. It may have been mistyped, or replaced by a newer
          one. Reply to the email we sent you and we will sort it out.
        </p>
      </Shell>
    );
  }

  const { envelope, state } = resolved;

  // Opening the letter is recorded, and the first open moves the offer from
  // "sent" to "viewed" — which is what the Offers rail is reporting.
  if (state === "open") {
    const ua = headers().get("user-agent");
    await appendAudit(envelope.id, {
      at: new Date().toISOString(),
      event: "viewed",
      ip: ip(),
      userAgent: ua,
    });
    if (envelope.offer.status === "sent") {
      await prisma.hiringOffer.update({
        where: { id: envelope.offerId },
        data: { status: "viewed", viewedAt: new Date() },
      });
    }
  }

  if (state === "signed") {
    return (
      <Shell title="Already signed">
        <p>
          You signed this offer on{" "}
          <strong>{formatHiringDate(envelope.signedAt)}</strong>. There is nothing more to do — we
          will be in touch about your start.
        </p>
        {envelope.pdfUrl && (
          <p>
            <a className="underline text-primary" href={envelope.pdfUrl}>
              Download your countersigned copy
            </a>
          </p>
        )}
      </Shell>
    );
  }

  if (state === "expired") {
    return (
      <Shell title="This link has expired">
        <p>
          Signing links are time-limited. Reply to the email we sent you and we will send a fresh
          one — the offer itself has not gone anywhere.
        </p>
      </Shell>
    );
  }

  if (state === "withdrawn" || state === "declined") {
    return (
      <Shell title="This offer is no longer open">
        <p>Please get in touch with us at hello@desma.in if you think that is a mistake.</p>
      </Shell>
    );
  }

  return (
    <SignClient
      token={params.token}
      documentHtml={envelope.documentHtml}
      signerName={envelope.signerName}
      expiresAt={envelope.offer.expiresAt?.toISOString() ?? null}
    />
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-2xl px-md sm:px-lg py-xl">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
          <h1 className="text-h2 text-on-surface">{title}</h1>
          <div className="text-body-md text-on-surface-variant space-y-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
