import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { SigningView } from "@/components/esign/SigningView";
import { formatLongDate } from "@/lib/esign/merge-values";
import { sessionCookieName, verifySession } from "@/lib/esign/otp";
import { otpChannels, recordOpened, resolveLink } from "@/lib/esign/signing";
import { signingViewData } from "@/lib/esign/signing-view-data";
import { OtpStep } from "./otp-step";

export const dynamic = "force-dynamic";

// A personal agreement: never indexed, cached or previewed.
export const metadata: Metadata = {
  title: "Sign your agreement — DESMA International",
  robots: { index: false, follow: false, nocache: true },
};

const CONTACT = { phone: "+91 77362 67775", email: "hello@desma.in" };

function Shell({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/desma-logo.png" alt="DESMA International" className="h-9 w-auto" />
          <span className="text-sm text-gray-500">Secure e-signature</span>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        {children}
        <p className="pt-6 text-sm text-gray-500">
          Questions? Call {CONTACT.phone} or email {CONTACT.email}.
        </p>
      </div>
    </main>
  );
}

export default async function SignPage({ params }: { params: { token: string } }) {
  const state = await resolveLink(params.token);
  if (state.kind === "invalid") {
    return (
      <Shell title="This link is not valid">
        <p>We could not find an agreement for this link. It may have been mistyped or replaced by a newer one. Contact DESMA and we will send you a fresh link.</p>
      </Shell>
    );
  }
  const { request, signer } = state;
  const name = request.templateVersion?.template.name ?? "agreement";
  if (state.kind === "expired") {
    return (
      <Shell title="This link has expired">
        <p>The link to sign your {name} is no longer active. Contact DESMA and we will send you a new one.</p>
      </Shell>
    );
  }
  if (state.kind === "cancelled") return <Shell title="This agreement was withdrawn"><p>DESMA cancelled this {name}, so it no longer needs signing.</p></Shell>;
  if (state.kind === "declined") return <Shell title="This agreement was declined"><p>The {name} was declined, so it can no longer be signed.</p></Shell>;
  if (state.kind === "waiting_turn") return <Shell title="Not ready yet"><p>Your {name} is not ready for your signature yet. We will message you as soon as it is.</p></Shell>;
  if (state.kind === "done") {
    return (
      <Shell title="You have signed">
        <p>
          You signed your {name}
          {signer.signedAt ? ` on ${formatLongDate(signer.signedAt)}` : ""}.{" "}
          {request.status === "signed" ? "The signed copy was emailed to you." : "You will get the final signed copy by email once everyone has signed."}
        </p>
      </Shell>
    );
  }

  const h = headers();
  const origin = { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"), userAgent: h.get("user-agent") };
  await recordOpened(request, signer, origin, signer.name);

  const session = cookies().get(sessionCookieName(signer.id))?.value;
  if (!verifySession(session, signer.id, signer.tokenHash ?? "", new Date())) {
    const channels = await otpChannels(request, signer);
    return (
      <Shell title={`Your ${name}`}>
        <p>Hello {signer.name}. Before you can read and sign it, confirm it is you with a one-time code.</p>
        {channels.length ? (
          <OtpStep token={params.token} channels={channels} />
        ) : (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            We have no email address on file to send your code to. Contact DESMA to add one.
          </p>
        )}
      </Shell>
    );
  }

  const data = await signingViewData(request, signer);
  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <header className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-5xl px-4 py-2 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/desma-logo.png" alt="DESMA International" className="h-8 w-auto" />
          <div className="min-w-0">
            <div className="font-bold truncate">{data.title}</div>
            <div className="text-xs text-gray-500 truncate">For {signer.name}</div>
          </div>
        </div>
      </header>
      <SigningView
        mode="public"
        {...data}
        fileUrl={`/api/sign/${params.token}/file`}
        completeUrl={`/api/sign/${params.token}/complete`}
        declineUrl={`/api/sign/${params.token}/decline`}
      />
    </main>
  );
}
